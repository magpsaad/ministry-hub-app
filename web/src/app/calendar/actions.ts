"use server";

import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import type { CalendarEventType } from "@/lib/calendar";
import type { EventAudience } from "@/lib/calendar-types";
import { calendarBucket, ministryFilePath } from "@/lib/storage";
import { getActiveMinistry } from "@/lib/ministry-context";
import { checkUpload, isUuid } from "@/lib/upload-check";
import { roleWords } from "@/lib/role-labels-server";

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

export async function createEventAction(input: EventInput) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return { error: "Not signed in", id: null };

  const { data, error } = await supabase
    .from("service_calendar_events")
    .insert({ ...eventFields(input), created_by: user.id })
    .select("id")
    .single();
  if (error) return { error: await roleWords(error.message), id: null };

  revalidatePath("/calendar");
  return { error: null, id: data.id as string };
}

export async function updateEventAction(eventId: string, input: EventInput) {
  const supabase = await createClient();
  const { data, error } = await supabase.from("service_calendar_events").update(eventFields(input)).eq("id", eventId).select("id");
  if (error) return { error: await roleWords(error.message) };
  if (!data || data.length === 0) return { error: "You don't have permission to change this event." };

  revalidatePath("/calendar");
  return { error: null };
}

export async function deleteEventAction(eventId: string) {
  const supabase = await createClient();
  const { data, error } = await supabase.from("service_calendar_events").delete().eq("id", eventId).select("id");
  if (error) return { error: error.message };
  if (!data || data.length === 0) return { error: "You don't have permission to delete this event." };

  revalidatePath("/calendar");
  return { error: null };
}

export async function uploadEventAttachmentAction(eventId: string, formData: FormData) {
  const file = formData.get("attachment") as File | null;
  // Security audit #6: a real PDF / image / Office file under 10 MB, for a
  // real event.
  const checked = await checkUpload(file, "attachment");
  if ("error" in checked) return { error: checked.error, path: null };
  if (!isUuid(eventId)) return { error: "Unknown event.", path: null };

  const [supabase, ministryId] = await Promise.all([createClient(), getActiveMinistry()]);
  const path = ministryFilePath(ministryId, "calendar", `${eventId}-${Date.now()}.${checked.ext}`);

  const { error: uploadError } = await supabase.storage.from(calendarBucket()).upload(path, file!, {
    contentType: checked.contentType,
  });
  if (uploadError) return { error: uploadError.message, path: null };

  const { data: existing } = await supabase
    .from("service_calendar_events")
    .select("attachment_url")
    .eq("id", eventId)
    .maybeSingle();

  const { error: updateError } = await supabase
    .from("service_calendar_events")
    .update({ attachment_url: path })
    .eq("id", eventId);
  if (updateError) return { error: updateError.message, path: null };

  if (existing?.attachment_url && existing.attachment_url !== path) {
    await supabase.storage.from(calendarBucket()).remove([existing.attachment_url]);
  }

  revalidatePath("/calendar");
  return { error: null, path };
}

export async function removeEventAttachmentAction(eventId: string, path: string) {
  const supabase = await createClient();
  await supabase.storage.from(calendarBucket()).remove([path]);

  const { error } = await supabase.from("service_calendar_events").update({ attachment_url: null }).eq("id", eventId);
  if (error) return { error: error.message };

  revalidatePath("/calendar");
  return { error: null };
}
