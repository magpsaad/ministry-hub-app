/** Recurring calendar events (owner-approved 11 Oct 2026, migration 0113).
 * A repeating event is saved as one event per occurrence, linked by a
 * series id; this works out the occurrence dates. Pure, so the event form
 * can show "Creates N events" as you choose, and the server uses the same
 * rule when it saves. Dates are "YYYY-MM-DD" calendar days. */

export type RepeatFreq = "weekly" | "biweekly" | "monthly_date" | "monthly_weekday";

export type Recurrence = {
  freq: RepeatFreq;
  /** Ends on a date, or after a number of times. */
  endType: "until" | "count";
  until: string;
  count: number;
};

/** No series is longer than this. */
export const MAX_OCCURRENCES = 52;

function parse(d: string): Date {
  const [y, m, day] = d.split("-").map(Number);
  return new Date(Date.UTC(y, m - 1, day));
}

function fmt(d: Date): string {
  return d.toISOString().slice(0, 10);
}

export function addDays(d: string, days: number): string {
  const x = parse(d);
  x.setUTCDate(x.getUTCDate() + days);
  return fmt(x);
}

/** Whole days from a to b. */
export function daysBetween(a: string, b: string): number {
  return Math.round((parse(b).getTime() - parse(a).getTime()) / 86_400_000);
}

const ORDINALS = ["1st", "2nd", "3rd", "4th", "5th"];
const WEEKDAYS = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];

/** "the 15th" */
export function monthDayLabel(start: string): string {
  const day = parse(start).getUTCDate();
  const suffix = day % 10 === 1 && day !== 11 ? "st" : day % 10 === 2 && day !== 12 ? "nd" : day % 10 === 3 && day !== 13 ? "rd" : "th";
  return `the ${day}${suffix}`;
}

/** "the 2nd Saturday" */
export function monthWeekdayLabel(start: string): string {
  const d = parse(start);
  return `the ${ORDINALS[Math.ceil(d.getUTCDate() / 7) - 1]} ${WEEKDAYS[d.getUTCDay()]}`;
}

/** The nth (1-5) `weekday` of a month, or null when that month has none. */
function nthWeekdayOf(year: number, month: number, weekday: number, nth: number): Date | null {
  const first = new Date(Date.UTC(year, month, 1));
  const offset = (weekday - first.getUTCDay() + 7) % 7;
  const d = new Date(Date.UTC(year, month, 1 + offset + (nth - 1) * 7));
  return d.getUTCMonth() === month ? d : null;
}

/** Every occurrence's start date, the first one included, in order. A
 * month without that date (the 31st) or that weekday (a 5th Sunday) is
 * skipped. Never more than MAX_OCCURRENCES. */
export function occurrenceDates(start: string, rule: Recurrence): string[] {
  const out: string[] = [];
  const s = parse(start);
  const limit = rule.endType === "count" ? Math.min(Math.max(1, Math.floor(rule.count || 1)), MAX_OCCURRENCES) : MAX_OCCURRENCES;
  const until = rule.endType === "until" ? rule.until : null;
  for (let i = 0; i < 400 && out.length < limit; i++) {
    let d: Date | null;
    if (rule.freq === "weekly" || rule.freq === "biweekly") {
      d = new Date(s);
      d.setUTCDate(s.getUTCDate() + i * (rule.freq === "weekly" ? 7 : 14));
    } else {
      const month = s.getUTCMonth() + i;
      const year = s.getUTCFullYear() + Math.floor(month / 12);
      const m = ((month % 12) + 12) % 12;
      if (rule.freq === "monthly_date") {
        d = new Date(Date.UTC(year, m, s.getUTCDate()));
        if (d.getUTCMonth() !== m) d = null;
      } else {
        d = nthWeekdayOf(year, m, s.getUTCDay(), Math.ceil(s.getUTCDate() / 7));
      }
    }
    if (!d) continue;
    const key = fmt(d);
    if (until && key > until) break;
    out.push(key);
  }
  return out;
}
