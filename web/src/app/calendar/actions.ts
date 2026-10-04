"use server";

import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import type { CalendarEventType } from "@/lib/calendar";
import { calendarBucket, ministryFilePath } from "@/lib/storage";
import { getActiveMinistry } from "@/lib/ministry-context";

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
  if (error) return { error: error.message, id: null };

  revalidatePath("/calendar");
  return { error: null, id: data.id as string };
}

export async function updateEventAction(eventId: string, input: EventInput) {
  const supabase = await createClient();
  const { data, error } = await supabase.from("service_calendar_events").update(eventFields(input)).eq("id", eventId).select("id");
  if (error) return { error: error.message };
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
  if (!file || file.size === 0) return { error: "No file selected", path: null };

  const [supabase, ministryId] = await Promise.all([createClient(), getActiveMinistry()]);
  const ext = file.name.split(".").pop() || "bin";
  const path = ministryFilePath(ministryId, "calendar", `${eventId}-${Date.now()}.${ext}`);

  const { error: uploadError } = await supabase.storage.from(calendarBucket()).upload(path, file, {
    contentType: file.type,
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
