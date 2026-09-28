import { cache } from "react";
import { createClient } from "@/lib/supabase/server";
import type { AttendanceWindowSettings } from "@/lib/attendance-window";

// Re-exported for every existing server-side importer -- the actual
// definitions live in attendance-window.ts now (no `@/lib/supabase/server`
// import), so a client component can pull them in directly without
// dragging server-only code into its bundle. See that file's header comment.
export type { AttendanceWindowSettings } from "@/lib/attendance-window";
export { isOnServiceWeekday, weekdayName, resolveAttendanceSince } from "@/lib/attendance-window";

export type AppSettings = {
  app_title_long: string;
  app_title_short: string;
  app_subtitle: string;
  logo_url: string | null;
  /** Page-header gradient start, buttons, headings (the brand colour). */
  theme_color: string;
  /** Page-header gradient end. */
  theme_color_light: string;
  /** Button hover / pressed shade. */
  theme_color_dark: string;
  /** Frame colour of the group-less Servants check-in QR code. */
  servants_qr_color: string;
  group_label: string;
  member_label: string;
  app_version: string;
  /** REQUIREMENTS.md §6.3 -- how many days before/after today a birthday
   * counts as "upcoming" on the Dashboard's Current Birthdays section. */
  birthday_window_days_before: number;
  birthday_window_days_after: number;
  /** ISO weekday (Monday=1..Sunday=7) of the regular service. Drives
   * self-check-in gating (§6.11), the Attendance tab's cutoff rule (§7.2),
   * and which attendance dates count toward average attendance % (§7.2). */
  service_weekday: number;
  /** "HH:MM:SS" -- same-day cutoff time for the Attendance tab's "Today
   * becomes available" rule (§7.2), paired with `timezone` below. */
  same_day_cutoff_time: string;
  /** IANA timezone every "which calendar day is it" question is answered
   * in -- dates, cutoffs, follow-ups, audit filters, displayed times. */
  timezone: string;
  /** Admin-editable labels for the school/affiliation field and the
   * program/field-of-study field. */
  university_label: string;
  program_label: string;
  /** When false every member is treated as Local (Actions Needed uses the
   * Local thresholds only) and all proximity UI is hidden. */
  proximity_enabled: boolean;
  /** Only meaningful while proximity_enabled: whether the Attendance tab
   * shows its Proximity column. */
  show_proximity_on_attendance: boolean;
  /** Actions Needed's "attended at least N times in the last X months"
   * look-back (was a fixed 12 months). */
  actions_needed_lookback_months: number;
  /** Word shown before a ladder position number on the admin screens,
   * e.g. "Yr" (Yr 0, Yr 5+), "Grade", "Level" (was hard-coded "Yr"). */
  ladder_position_label: string;
  /** Rolling average-attendance windows (null = no cap). */
  youth_attendance_window_weeks: number | null;
  servant_attendance_window_weeks: number | null;
};

const SETTINGS_COLUMNS =
  "app_title_long, app_title_short, app_subtitle, logo_url, theme_color, theme_color_light, theme_color_dark, servants_qr_color, group_label, member_label, app_version, birthday_window_days_before, birthday_window_days_after, service_weekday, same_day_cutoff_time, timezone, university_label, program_label, proximity_enabled, show_proximity_on_attendance, actions_needed_lookback_months, ladder_position_label, youth_attendance_window_weeks, servant_attendance_window_weeks";

/**
 * REQUIREMENTS.md §2 -- everything about the app's identity, vocabulary,
 * schedule and timezone is driven by this one row, never hardcoded.
 *
 * Deliberately has NO built-in fallback values (MULTI_TENANT_PLAN.md §10,
 * A2): a fallback would silently substitute one ministry's weekday,
 * timezone and branding for another's. The row is readable without signing
 * in (login/check-in pages need it), so failing to read it is a real error
 * and is surfaced as one rather than papered over.
 *
 * The displayed `app_version` comes from app_releases (latest `released_on`),
 * with app_settings.app_version only as a last resort if that's empty.
 *
 * React.cache()-memoized per request: the root layout, the page itself and
 * every lib helper share one read, so a page never queries settings twice.
 * Callers share one object, so treat the result as read-only.
 */
export const getAppSettings = cache(async (): Promise<AppSettings> => {
  const supabase = await createClient();
  const [{ data, error }, { data: latestRelease }] = await Promise.all([
    supabase.from("app_settings").select(SETTINGS_COLUMNS).single(),
    supabase.from("app_releases").select("version").order("released_on", { ascending: false }).order("created_at", { ascending: false }).limit(1).maybeSingle(),
  ]);

  if (error || !data) {
    throw new Error(`App settings could not be loaded${error ? `: ${error.message}` : ""}`);
  }
  const base = data as AppSettings;
  return { ...base, app_version: latestRelease?.version ?? base.app_version };
});

/**
 * REQUIREMENTS.md §7.2/§6.13 -- the two rolling-attendance-window settings
 * plus the service weekday. Now just a view onto the cached getAppSettings()
 * row (it used to be its own separate query on every screen that computes
 * average attendance %).
 */
export async function getAttendanceWindowSettings(): Promise<AttendanceWindowSettings> {
  const s = await getAppSettings();
  return {
    youth_attendance_window_weeks: s.youth_attendance_window_weeks,
    servant_attendance_window_weeks: s.servant_attendance_window_weeks,
    service_weekday: s.service_weekday,
  };
}
