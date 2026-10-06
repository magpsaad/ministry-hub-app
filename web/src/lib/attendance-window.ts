import { shiftDateKey, todayInZone } from "@/lib/timezone";

/**
 * Pure, dependency-free average-attendance-% helpers -- split out of
 * app-settings.ts so a client component (AnalyticsInteractive.tsx) can
 * import them directly without dragging in `@/lib/supabase/server`
 * (app-settings.ts's getAppSettings()/getAttendanceWindowSettings() are
 * server-only). app-settings.ts re-exports all of this for its existing
 * server-side importers, so nothing else needs to change.
 */

export type AttendanceWindowSettings = {
  /** null = no rolling cap -- calculate over the person's entire attendance history since their Join Date. */
  youth_attendance_window_weeks: number | null;
  servant_attendance_window_weeks: number | null;
  /** ISO weekday (Monday=1..Sunday=7), same numbering as the is_service_day()
   * Postgres function -- the regular service day, Friday (5) by default for
   * this deployment. */
  service_weekday: number;
  /** The ministry's timezone (App Settings) -- "today" for the rolling
   * window is that calendar day, not the server's UTC one. */
  timezone: string;
};

/**
 * REQUIREMENTS.md §7.2 -- true if the given ISO date-only string
 * ("YYYY-MM-DD") falls on the configured service weekday. Every average-
 * attendance-% calculation (members and servants alike) only counts
 * service-weekday dates, both as "tracked" opportunities and as presence --
 * an off-day attendance row (a retreat, a trip) is real and stays visible
 * everywhere else, it just shouldn't move this specific percentage. Manual
 * y/m/d parsing avoids the UTC-midnight-parse timezone bug `new Date(iso)`
 * has for a date-only string.
 */
export function isOnServiceWeekday(dateISO: string, serviceWeekday: number): boolean {
  const [y, m, d] = dateISO.split("-").map(Number);
  const jsDay = new Date(y, m - 1, d).getDay(); // 0 = Sunday .. 6 = Saturday
  const isoDay = jsDay === 0 ? 7 : jsDay;
  return isoDay === serviceWeekday;
}

const WEEKDAY_NAMES = ["Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday", "Sunday"];

/** ISO weekday (1..7) -> its name, e.g. for the average-attendance-%
 * captions ("...counting only Fridays"). Shared with the App Settings
 * screen's Service Day dropdown so the wording always matches whatever's
 * actually configured, not a hardcoded "Friday." */
export function weekdayName(serviceWeekday: number): string {
  return WEEKDAY_NAMES[serviceWeekday - 1] ?? "service day";
}

/**
 * The shared "since" cutoff for an average-attendance-% calculation: the
 * later of (today - windowWeeks) and the person's own join date, so the
 * window never reaches before they actually joined. A null windowWeeks
 * means no rolling cap at all -- since is just their join date, i.e. their
 * entire attendance history. Returns null if the person has never
 * attended (no join date yet).
 */
export function resolveAttendanceSince(joinDate: string | null, windowWeeks: number | null, timeZone: string): string | null {
  if (!joinDate) return null;
  if (windowWeeks === null) return joinDate;

  // Owner-reported (5 Oct 2026): computed from the UTC clock, the window
  // moved a day early every evening -- on a Friday night it dropped a
  // service from the count. Today is the ministry's calendar day.
  const windowStartISO = shiftDateKey(todayInZone(timeZone), { days: -windowWeeks * 7 });
  return joinDate > windowStartISO ? joinDate : windowStartISO;
}
