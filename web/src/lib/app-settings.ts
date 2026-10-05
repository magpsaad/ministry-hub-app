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
  /** Group-page header gradient (start / end) shown while "My Assigned
   * List" is ticked (was a hard-coded pink). */
  my_assigned_header_color: string;
  my_assigned_header_color_light: string;
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
  /** "HH:MM:SS" -- migration 0074: the public check-in page (searching for a
   * name, checking in) is open on the service day between these two times,
   * in `timezone` (default the whole day). */
  checkin_opens_at: string;
  checkin_closes_at: string;
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
  /** GROUP_LADDER_PLAN.md §3.1 -- added to a level before it's shown, so a
   * ministry whose first level is Grade 9 stores offset 8 (0 for SAY). */
  level_number_offset: number;
  /** The default yearly name pattern new groups start from, e.g.
   * "{cohort_year} - Yr {level}" (Q3). Null = names are typed by hand. */
  group_name_template: string | null;
  /** How the hand-over group is renamed each year, e.g.
   * "{cohort_year} - Transitioning" (D9). */
  terminal_name_pattern: string;
  /** Rolling average-attendance windows (null = no cap). */
  youth_attendance_window_weeks: number | null;
  servant_attendance_window_weeks: number | null;
  /** Whether granting someone Sub-Coordinator of a group automatically also
   * makes them a Servant of it (MULTI_TENANT_PLAN.md §5.5, F12; was always
   * on). */
  sub_coordinator_auto_servant: boolean;
  /** Migration 0087 -- whether youth records keep parents' contact details
   * (Parent 1 / Parent 2 name, phone, email). Off unless switched on. */
  show_parent_contacts: boolean;
  /** Migration 0089 -- lock the app after this many minutes without use
   * (2, 5, 10, 15 or 30); null = off. */
  idle_lock_minutes: number | null;
};

const SETTINGS_COLUMNS =
  "app_title_long, app_title_short, app_subtitle, logo_url, theme_color, theme_color_light, theme_color_dark, servants_qr_color, my_assigned_header_color, my_assigned_header_color_light, group_label, member_label, app_version, birthday_window_days_before, birthday_window_days_after, service_weekday, same_day_cutoff_time, checkin_opens_at, checkin_closes_at, timezone, university_label, program_label, proximity_enabled, show_proximity_on_attendance, actions_needed_lookback_months, ladder_position_label, level_number_offset, group_name_template, terminal_name_pattern, youth_attendance_window_weeks, servant_attendance_window_weeks, sub_coordinator_auto_servant, show_parent_contacts, idle_lock_minutes";

/**
 * REQUIREMENTS.md §2 -- everything about the app's identity, vocabulary,
 * schedule and timezone is driven by this one row, never hardcoded. It is
 * THIS ministry's row: the security rule only ever returns the row of the
 * ministry whose address the request came in on (MULTI_TENANT_PLAN.md §3.2).
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
