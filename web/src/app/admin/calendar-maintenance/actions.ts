"use server";

import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import {
  computeHolidaysForYear,
  computeCanadianHolidaysForYear,
  computeCustomHolidaysForYear,
  type HolidayRule,
} from "@/lib/holidays";

/** Bulk-preloads the computed holiday set for a year (Coptic + Canadian +
 * any active custom rules, each toggle-able), skipping any that already
 * exist (matched by title + start date) so re-running is safe. */
export async function preloadHolidaysAction(
  year: number,
  options: { includeCoptic: boolean; includeCanadian: boolean },
) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return { error: "Not signed in", inserted: 0, skipped: 0 };

  const rules = await fetchHolidayRules(supabase);
  const holidays = [
    ...(options.includeCoptic ? computeHolidaysForYear(year) : []),
    ...(options.includeCanadian ? computeCanadianHolidaysForYear(year) : []),
    ...computeCustomHolidaysForYear(year, rules),
  ];

  const { data: existing } = await supabase
    .from("service_calendar_events")
    .select("title, start_date")
    .eq("event_type", "Holiday")
    .gte("start_date", `${year}-01-01`)
    .lte("start_date", `${year}-12-31`);

  const existingKeys = new Set((existing ?? []).map((e) => `${e.title}|${e.start_date}`));
  const toInsert = holidays.filter((h) => !existingKeys.has(`${h.title}|${h.startDate}`));

  if (toInsert.length > 0) {
    const { error } = await supabase.from("service_calendar_events").insert(
      toInsert.map((h) => ({
        title: h.title,
        event_type: "Holiday" as const,
        start_date: h.startDate,
        end_date: h.endDate,
        all_day: true,
        created_by: user.id,
      })),
    );
    if (error) return { error: error.message, inserted: 0, skipped: 0 };
  }

  revalidatePath("/");
  return { error: null, inserted: toInsert.length, skipped: holidays.length - toInsert.length };
}

async function fetchHolidayRules(supabase: Awaited<ReturnType<typeof createClient>>): Promise<HolidayRule[]> {
  const { data } = await supabase
    .from("holiday_rules")
    .select("id, title, basis, start_month, start_day, start_offset, duration_days, is_active")
    .order("created_at", { ascending: true });
  return (data ?? []) as HolidayRule[];
}

export async function getHolidayRulesAction(): Promise<HolidayRule[]> {
  const supabase = await createClient();
  return fetchHolidayRules(supabase);
}

export type AddHolidayRuleInput = {
  title: string;
  basis: "fixed" | "pascha";
  startMonth: number | null;
  startDay: number | null;
  startOffset: number | null;
  durationDays: number;
};

export async function addHolidayRuleAction(input: AddHolidayRuleInput) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return { error: "Not signed in" };

  const { error } = await supabase.from("holiday_rules").insert({
    title: input.title,
    basis: input.basis,
    start_month: input.basis === "fixed" ? input.startMonth : null,
    start_day: input.basis === "fixed" ? input.startDay : null,
    start_offset: input.basis === "pascha" ? input.startOffset : null,
    duration_days: input.durationDays,
    created_by: user.id,
  });
  if (error) return { error: error.message };

  revalidatePath("/admin/calendar-maintenance");
  return { error: null };
}

export async function deleteHolidayRuleAction(id: string) {
  const supabase = await createClient();
  const { error } = await supabase.from("holiday_rules").delete().eq("id", id);
  if (error) return { error: error.message };

  revalidatePath("/admin/calendar-maintenance");
  return { error: null };
}

export async function toggleHolidayRuleAction(id: string, isActive: boolean) {
  const supabase = await createClient();
  const { error } = await supabase.from("holiday_rules").update({ is_active: isActive }).eq("id", id);
  if (error) return { error: error.message };

  revalidatePath("/admin/calendar-maintenance");
  return { error: null };
}

/** Migration 0082 -- the calendar's 30-day recycle bin (Admins only; the
 * database only shows it to them). */
export type DeletedEvent = {
  id: string;
  title: string;
  start_date: string | null;
  deleted_at: string;
  deleted_by_name: string | null;
};

export async function getDeletedEventsAction(): Promise<DeletedEvent[]> {
  const supabase = await createClient();
  const { data } = await supabase
    .from("calendar_events_deleted")
    .select("id, event, deleted_at, deleted_by")
    .order("deleted_at", { ascending: false })
    .limit(200);
  const rows = (data ?? []) as { id: string; event: { title?: string; start_date?: string }; deleted_at: string; deleted_by: string | null }[];
  const ids = [...new Set(rows.map((r) => r.deleted_by).filter((x): x is string => !!x))];
  const names = new Map<string, string>();
  if (ids.length > 0) {
    const { data: people } = await supabase.from("profiles").select("id, full_name").in("id", ids);
    for (const p of (people ?? []) as { id: string; full_name: string }[]) names.set(p.id, p.full_name);
  }
  return rows.map((r) => ({
    id: r.id,
    title: r.event?.title ?? "(untitled)",
    start_date: r.event?.start_date ?? null,
    deleted_at: r.deleted_at,
    deleted_by_name: r.deleted_by ? (names.get(r.deleted_by) ?? null) : null,
  }));
}

export async function restoreDeletedEventAction(id: string): Promise<{ error: string | null }> {
  const supabase = await createClient();
  const { error } = await supabase.rpc("restore_calendar_event", { p_id: id });
  if (error) return { error: error.message };
  revalidatePath("/calendar");
  revalidatePath("/admin/calendar-maintenance");
  return { error: null };
}
