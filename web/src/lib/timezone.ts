/**
 * Date/time helpers that always answer "which calendar day / what time is
 * it" in the ministry's configured timezone (App Settings -> Timezone),
 * never the viewer's own device timezone and never a hard-coded zone
 * (MULTI_TENANT_PLAN.md §10, A1 -- this file used to pin America/New_York).
 *
 * Server code passes `settings.timezone` (lib/app-settings.ts); client
 * components get the same value from `useTimezone()` (components/
 * TimezoneProvider.tsx), which the root layout fills from App Settings.
 */

/** "YYYY-MM-DD" for the given instant, in `timeZone`. Use this instead of
 * `isoString.slice(0, 10)`, which reads the UTC calendar date and silently
 * misdates anything that happened in the local evening. */
export function dateKeyInZone(iso: string, timeZone: string): string {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(new Date(iso));
}

/** "YYYY-MM-DD" for right now, in `timeZone`. */
export function todayInZone(timeZone: string): string {
  return dateKeyInZone(new Date().toISOString(), timeZone);
}

/** A "YYYY-MM-DD" key moved by whole days and/or months -- plain calendar
 * arithmetic, so no timezone can shift it. Start from todayInZone(), never
 * from `new Date()` (the server's clock is UTC; a device's is its own). */
export function shiftDateKey(key: string, { days = 0, months = 0 }: { days?: number; months?: number }): string {
  const [y, m, d] = key.split("-").map(Number);
  return new Date(Date.UTC(y, m - 1 + months, d + days)).toISOString().slice(0, 10);
}

/** Today's date plus minutes-since-midnight right now, both in `timeZone`
 * (the same-day cutoff rule needs both). */
export function nowInZone(timeZone: string): { date: string; timeMinutes: number } {
  const now = new Date();
  const date = dateKeyInZone(now.toISOString(), timeZone);
  const timeStr = new Intl.DateTimeFormat("en-GB", {
    timeZone,
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  }).format(now);
  const [h, m] = timeStr.split(":").map(Number);
  return { date, timeMinutes: (h % 24) * 60 + m };
}

/** Formats an instant for display in `timeZone` (locale/format style still
 * follows the browser -- only the timezone is pinned). */
export function formatDateTimeInZone(iso: string, timeZone: string, options: Intl.DateTimeFormatOptions): string {
  return new Date(iso).toLocaleString(undefined, { ...options, timeZone });
}

/** Formats a pure "YYYY-MM-DD" calendar-date key for display. Anchors it as
 * UTC noon-of-day purely for formatting so the viewer's own browser
 * timezone can never shift it onto an adjacent calendar day -- a date-only
 * key has no "instant" to convert. */
export function formatDateKey(dateKey: string, options: Intl.DateTimeFormatOptions): string {
  const [y, m, d] = dateKey.split("-").map(Number);
  return new Date(Date.UTC(y, m - 1, d)).toLocaleDateString(undefined, { ...options, timeZone: "UTC" });
}

/** The zone's UTC offset, in minutes, at the given instant (DST-aware),
 * e.g. -240 for EDT, +330 for India. */
function offsetMinutesAt(instant: Date, timeZone: string): number {
  const name =
    new Intl.DateTimeFormat("en-US", { timeZone, timeZoneName: "longOffset" })
      .formatToParts(instant)
      .find((p) => p.type === "timeZoneName")?.value ?? "GMT";
  const match = name.match(/GMT([+-])(\d{2}):?(\d{2})?/);
  if (!match) return 0; // "GMT" alone = UTC
  const sign = match[1] === "-" ? -1 : 1;
  return sign * (Number(match[2]) * 60 + Number(match[3] ?? 0));
}

/** The UTC instant of midnight at the start of `dateStr` ("YYYY-MM-DD") in
 * `timeZone`, as an ISO string -- DST-aware. Use this to build a
 * `timestamptz` range filter for "this calendar day" instead of handing a
 * bare "YYYY-MM-DD" to a `.gte`/`.lte` query (Postgres would read that in
 * the database session's timezone, UTC on Supabase). */
export function zoneMidnightUtcIso(dateStr: string, timeZone: string): string {
  const naiveUtc = new Date(`${dateStr}T00:00:00.000Z`).getTime();
  // First guess using the offset at naive-UTC midnight, then correct once
  // with the offset at the guessed instant (handles a DST change that day).
  let guess = naiveUtc - offsetMinutesAt(new Date(naiveUtc), timeZone) * 60000;
  guess = naiveUtc - offsetMinutesAt(new Date(guess), timeZone) * 60000;
  return new Date(guess).toISOString();
}
