"use server";

import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import type { CalendarEventType } from "@/lib/calendar";
import type { EventAudience } from "@/lib/calendar-types";
import { calendarBucket, ministryFilePath } from "@/lib/storage";
import { getActiveMinistry } from "@/lib/ministry-context";
import { checkUpload, isUuid } from "@/lib/upload-check";
import { roleWords } from "@/lib/role-labels-server";
import { addDays, daysBetween, occurrenceDates, type Recurrence } from "@/lib/recurrence";

/** Recurring events (0113): which events an edit or delete applies to. */
export type SeriesScope = "this" | "following";

export type EventInput = {
  title: string;
  description: string | null;
  event_type: CalendarEventType;
  start_date: string;
  end_date: string;
  all_day: boolean;
  start_time: string | null;
  end_time: string | null;
  location: string | null;
  /** Sent only by people who may set them (the database also checks,
   * 0111); left out, the event keeps what it has. */
  take_attendance?: boolean;
  audience?: EventAudience;
  audience_levels?: number[];
  audience_group_ids?: string[];
};

/** REQUIREMENTS.md §6.8 -- event creation/editing/deletion is open to all
 * Servants (confirmed intentional, not restricted); RLS enforces this
 * (migration 0082: except people whose only role is Read-Only). The
 * database itself writes the audit entry for every add/edit/delete and
 * keeps deleted events in a 30-day recycle bin, so these actions don't log. */
/** Security audit #5: only the event's own fields, whatever else was sent
 * (the database also refuses other fields and sets "created by", 0084). */
function eventFields(input: EventInput): EventInput {
  return {
    title: input.title,
    description: input.description,
    event_type: input.event_type,
    start_date: input.start_date,
    end_date: input.end_date,
    all_day: input.all_day,
    start_time: input.start_time,
    end_time: input.end_time,
    location: input.location,
    ...(input.take_attendance === undefined
      ? {}
      : {
          take_attendance: input.take_attendance,
          audience: input.audience ?? "all",
          audience_levels: input.audience_levels ?? [],
          audience_group_ids: input.audience_group_ids ?? [],
        }),
  };
}

/** Creates the event -- or, with a repeat rule (owner-approved 11 Oct 2026,
 * migration 0113), one event per occurrence, linked by a series id, so
 * attendance, check-in and Calendar Sync treat each one as an ordinary
 * event. Returns the first occurrence's id. */
export async function createEventAction(input: EventInput, recurrence: Recurrence | null = null) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return { error: "Not signed in", id: null };

  const fields = eventFields(input);
  let rows: Record<string, unknown>[] = [{ ...fields, created_by: user.id }];
  if (recurrence) {
    const dates = occurrenceDates(input.start_date, recurrence);
    if (dates.length < 2) return { error: "That repeat rule gives only one date -- untick Recurring or change it.", id: null };
    const span = daysBetween(input.start_date, input.end_date);
    const seriesId = crypto.randomUUID();
    rows = dates.map((d) => ({ ...fields, start_date: d, end_date: addDays(d, span), series_id: seriesId, created_by: user.id }));
  }

  const { data, error } = await supabase.from("service_calendar_events").insert(rows).select("id, start_date");
  if (error) return { error: await roleWords(error.message), id: null };
  const first = [...(data ?? [])].sort((a, b) => (a.start_date < b.start_date ? -1 : 1))[0];

  revalidatePath("/calendar");
  return { error: null, id: (first?.id as string) ?? null };
}

/** The events an edit or delete applies to: this one, or (scope
 * "following") this one and every later occurrence of its series. */
async function seriesTargets(
  supabase: Awaited<ReturnType<typeof createClient>>,
  eventId: string,
  scope: SeriesScope,
): Promise<{ id: string; start_date: string; end_date: string }[] | null> {
  const { data: ev } = await supabase
    .from("service_calendar_events")
    .select("id, series_id, start_date, end_date")
    .eq("id", eventId)
    .maybeSingle();
  if (!ev) return null;
  if (scope === "this" || !ev.series_id) return [{ id: ev.id, start_date: ev.start_date, end_date: ev.end_date }];
  const { data } = await supabase
    .from("service_calendar_events")
    .select("id, start_date, end_date")
    .eq("series_id", ev.series_id)
    .gte("start_date", ev.start_date)
    .order("start_date");
  return (data ?? []) as { id: string; start_date: string; end_date: string }[];
}

/** Saves an edit. Scope "following" (a recurring event) applies it to this
 * occurrence and every later one, each moved by the same number of days
 * if the date changed; earlier occurrences are never touched. A repeat
 * rule on an event that doesn't repeat yet turns it into a series. */
export async function updateEventAction(
  eventId: string,
  input: EventInput,
  scope: SeriesScope = "this",
  recurrence: Recurrence | null = null,
) {
  const supabase = await createClient();
  const targets = await seriesTargets(supabase, eventId, scope);
  if (!targets || targets.length === 0) return { error: "You don't have permission to change this event." };

  const fields = eventFields(input);
  const self = targets.find((t) => t.id === eventId) ?? targets[0];
  const shift = daysBetween(self.start_date, input.start_date);
  const span = daysBetween(input.start_date, input.end_date);
  const results = await Promise.all(
    targets.map((t) => {
      const start = t.id === eventId ? input.start_date : addDays(t.start_date, shift);
      return supabase
        .from("service_calendar_events")
        .update({ ...fields, start_date: start, end_date: addDays(start, span) })
        .eq("id", t.id)
        .select("id");
    }),
  );
  const failed = results.find((r) => r.error);
  if (failed?.error) return { error: await roleWords(failed.error.message) };
  if (results.every((r) => !r.data || r.data.length === 0)) return { error: "You don't have permission to change this event." };

  // Making a one-off event repeat: it becomes the first of a new series.
  if (recurrence && scope === "this") {
    const { data: ev } = await supabase.from("service_calendar_events").select("series_id").eq("id", eventId).maybeSingle();
    if (ev && !ev.series_id) {
      const dates = occurrenceDates(input.start_date, recurrence).slice(1);
      if (dates.length > 0) {
        const {
          data: { user },
        } = await supabase.auth.getUser();
        const seriesId = crypto.randomUUID();
        const { error: linkError } = await supabase.from("service_calendar_events").update({ series_id: seriesId }).eq("id", eventId);
        if (linkError) return { error: await roleWords(linkError.message) };
        const { data: attached } = await supabase.from("service_calendar_events").select("attachment_url").eq("id", eventId).maybeSingle();
        const { error: insertError } = await supabase.from("service_calendar_events").insert(
          dates.map((d) => ({
            ...fields,
            start_date: d,
            end_date: addDays(d, span),
            series_id: seriesId,
            created_by: user?.id,
          })),
        );
        if (insertError) return { error: await roleWords(insertError.message) };
        // New events can't be created with an attachment; share it after.
        if (attached?.attachment_url) {
          await supabase
            .from("service_calendar_events")
            .update({ attachment_url: attached.attachment_url })
            .eq("series_id", seriesId);
        }
      }
    }
  }

  revalidatePath("/calendar");
  return { error: null };
}

export async function deleteEventAction(eventId: string, scope: SeriesScope = "this") {
  const supabase = await createClient();
  const targets = await seriesTargets(supabase, eventId, scope);
  if (!targets || targets.length === 0) return { error: "You don't have permission to delete this event." };
  const { data: paths } = await supabase
    .from("service_calendar_events")
    .select("attachment_url")
    .in("id", targets.map((t) => t.id));
  const { data, error } = await supabase
    .from("service_calendar_events")
    .delete()
    .in("id", targets.map((t) => t.id))
    .select("id");
  if (error) return { error: error.message };
  if (!data || data.length === 0) return { error: "You don't have permission to delete this event." };
  await removeUnusedAttachments(supabase, (paths ?? []).map((p) => p.attachment_url as string | null));

  revalidatePath("/calendar");
  return { error: null };
}

/** A series shares one attachment file: a file is only removed from
 * storage once no event uses it any more. */
async function removeUnusedAttachments(supabase: Awaited<ReturnType<typeof createClient>>, paths: (string | null)[]) {
  for (const path of new Set(paths.filter((p): p is string => !!p))) {
    const { count } = await supabase
      .from("service_calendar_events")
      .select("id", { count: "exact", head: true })
      .eq("attachment_url", path);
    if ((count ?? 0) === 0) await supabase.storage.from(calendarBucket()).remove([path]);
  }
}

export async function uploadEventAttachmentAction(eventId: string, formData: FormData, scope: SeriesScope = "this") {
  const file = formData.get("attachment") as File | null;
  // Security audit #6: a real PDF / image / Office file under 10 MB, for a
  // real event.
  const checked = await checkUpload(file, "attachment");
  if ("error" in checked) return { error: checked.error, path: null };
  if (!isUuid(eventId)) return { error: "Unknown event.", path: null };

  const [supabase, ministryId] = await Promise.all([createClient(), getActiveMinistry()]);
  const targets = await seriesTargets(supabase, eventId, scope);
  if (!targets || targets.length === 0) return { error: "Unknown event.", path: null };
  const path = ministryFilePath(ministryId, "calendar", `${eventId}-${Date.now()}.${checked.ext}`);

  const { error: uploadError } = await supabase.storage.from(calendarBucket()).upload(path, file!, {
    contentType: checked.contentType,
  });
  if (uploadError) return { error: uploadError.message, path: null };

  const ids = targets.map((t) => t.id);
  const { data: existing } = await supabase.from("service_calendar_events").select("attachment_url").in("id", ids);

  const { error: updateError } = await supabase.from("service_calendar_events").update({ attachment_url: path }).in("id", ids);
  if (updateError) return { error: updateError.message, path: null };

  await removeUnusedAttachments(supabase, (existing ?? []).map((e) => e.attachment_url as string | null));

  revalidatePath("/calendar");
  return { error: null, path };
}

export async function removeEventAttachmentAction(eventId: string, path: string, scope: SeriesScope = "this") {
  const supabase = await createClient();
  const targets = await seriesTargets(supabase, eventId, scope);
  if (!targets || targets.length === 0) return { error: "Unknown event." };

  const { error } = await supabase
    .from("service_calendar_events")
    .update({ attachment_url: null })
    .in("id", targets.map((t) => t.id));
  if (error) return { error: error.message };
  await removeUnusedAttachments(supabase, [path]);

  revalidatePath("/calendar");
  return { error: null };
}
