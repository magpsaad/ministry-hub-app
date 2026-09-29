"use server";

import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import { getCalendarEvents, type CalendarEvent, type CalendarEventType } from "@/lib/calendar";
import { calendarBucket, ministryFilePath } from "@/lib/storage";
import { getActiveMinistry } from "@/lib/ministry-context";
import { getAppSettings, weekdayName } from "@/lib/app-settings";
import { logAudit } from "@/lib/audit";

export async function getCalendarEventsAction(): Promise<CalendarEvent[]> {
  return getCalendarEvents();
}

/** Bootstraps the calendar modal: events plus the ministry's configured
 * service weekday, dynamically labeling the 4th view (was hardcoded
 * "Fridays" in the old app). */
export async function getCalendarBootstrapAction(): Promise<{
  events: CalendarEvent[];
  serviceWeekday: number;
  serviceWeekdayLabel: string;
  logoUrl: string | null;
  appTitleShort: string;
  appVersion: string;
}> {
  const [events, settings] = await Promise.all([getCalendarEvents(), getAppSettings()]);
  return {
    events,
    serviceWeekday: settings.service_weekday,
    serviceWeekdayLabel: `${weekdayName(settings.service_weekday)}s`,
    logoUrl: settings.logo_url,
    appTitleShort: settings.app_title_short,
    appVersion: settings.app_version,
  };
}

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
 * Servants (confirmed intentional, not restricted); RLS enforces this. */
export async function createEventAction(input: EventInput) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return { error: "Not signed in", id: null };

  const { data, error } = await supabase
    .from("service_calendar_events")
    .insert({ ...input, created_by: user.id })
    .select("id")
    .single();
  if (error) return { error: error.message, id: null };

  await logAudit(user.id, "CALENDAR_EVENT_CREATED", { details: { eventId: data.id } });
  revalidatePath("/");
  return { error: null, id: data.id as string };
}

export async function updateEventAction(eventId: string, input: EventInput) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  const { error } = await supabase.from("service_calendar_events").update(input).eq("id", eventId);
  if (error) return { error: error.message };

  if (user) await logAudit(user.id, "CALENDAR_EVENT_UPDATED", { details: { eventId } });
  revalidatePath("/");
  return { error: null };
}

export async function deleteEventAction(eventId: string) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  const { error } = await supabase.from("service_calendar_events").delete().eq("id", eventId);
  if (error) return { error: error.message };

  if (user) await logAudit(user.id, "CALENDAR_EVENT_DELETED", { details: { eventId } });
  revalidatePath("/");
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

  revalidatePath("/");
  return { error: null, path };
}

export async function removeEventAttachmentAction(eventId: string, path: string) {
  const supabase = await createClient();
  await supabase.storage.from(calendarBucket()).remove([path]);

  const { error } = await supabase.from("service_calendar_events").update({ attachment_url: null }).eq("id", eventId);
  if (error) return { error: error.message };

  revalidatePath("/");
  return { error: null };
}
