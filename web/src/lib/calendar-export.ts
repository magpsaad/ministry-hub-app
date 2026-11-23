import type { CalendarEvent, CalendarEventType } from "@/lib/calendar-types";
import { EVENT_TYPES } from "@/lib/calendar-types";
import { csvCell } from "@/lib/csv";

/** Owner-requested (22 Nov 2026): the Service Calendar's events as a CSV
 * list (CalendarExportModal). Pure, so it runs on the phone from the events
 * the page already loaded -- no database calls or server time.
 *
 * Every day: one row per event, with its start and end dates.
 * Service day only: one row per service day an event falls on -- the same
 * rows as the calendar's Fridays view (a multi-day event that spans three
 * Fridays is on each of them). */

export type CalendarExportRow = { date: string; endDate: string | null; event: CalendarEvent };

const DAY_NAMES = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];

function toISO(d: Date): string {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

function dayName(iso: string): string {
  return DAY_NAMES[new Date(`${iso}T00:00:00`).getDay()];
}

/** "19:30:00" -> "7:30 PM". */
function clock(time: string): string {
  const [h, m] = time.split(":").map(Number);
  return `${h % 12 === 0 ? 12 : h % 12}:${String(m).padStart(2, "0")} ${h < 12 ? "AM" : "PM"}`;
}

function timeText(e: CalendarEvent): string {
  // Events brought over from the old calendar are often 12:00 AM - 11:59 PM.
  if (e.all_day || !e.start_time || (e.start_time.startsWith("00:00") && e.end_time?.startsWith("23:59"))) return "All day";
  return e.end_time ? `${clock(e.start_time)} – ${clock(e.end_time)}` : clock(e.start_time);
}

/** Every date the event covers that falls on the service day (ISO weekday,
 * 1=Monday .. 7=Sunday). */
function serviceDates(e: CalendarEvent, isoWeekday: number): string[] {
  const out: string[] = [];
  const end = new Date(`${e.end_date}T00:00:00`);
  for (let d = new Date(`${e.start_date}T00:00:00`); d.getTime() <= end.getTime(); d.setDate(d.getDate() + 1)) {
    if ((d.getDay() === 0 ? 7 : d.getDay()) === isoWeekday) out.push(toISO(d));
  }
  return out;
}

/** Each event type's rows, for the type counts and the export itself. */
export function calendarExportRowsByType(
  events: CalendarEvent[],
  serviceDayOnly: boolean,
  serviceWeekday: number,
): Map<CalendarEventType, CalendarExportRow[]> {
  const byType = new Map<CalendarEventType, CalendarExportRow[]>(EVENT_TYPES.map((t) => [t, []]));
  for (const e of events) {
    const rows = serviceDayOnly
      ? serviceDates(e, serviceWeekday).map((date) => ({ date, endDate: null, event: e }))
      : [{ date: e.start_date, endDate: e.end_date !== e.start_date ? e.end_date : null, event: e }];
    byType.get(e.event_type)?.push(...rows);
  }
  return byType;
}

/** The chosen types' rows, by date, then start time (all-day first), then name. */
export function calendarExportRows(
  rowsByType: Map<CalendarEventType, CalendarExportRow[]>,
  types: Set<CalendarEventType>,
): CalendarExportRow[] {
  const startKey = (e: CalendarEvent) => (e.all_day ? "" : (e.start_time ?? ""));
  return EVENT_TYPES.filter((t) => types.has(t))
    .flatMap((t) => rowsByType.get(t) ?? [])
    .sort((a, b) => a.date.localeCompare(b.date) || startKey(a.event).localeCompare(startKey(b.event)) || a.event.title.localeCompare(b.event.title));
}

export function calendarExportCsv(rows: CalendarExportRow[], serviceDayOnly: boolean): string {
  const header = serviceDayOnly
    ? ["Date", "Day", "Time", "Event", "Type", "Details", "Location"]
    : ["Start Date", "End Date", "Day", "Time", "Event", "Type", "Details", "Location"];
  const lines = rows.map(({ date, endDate, event: e }) => {
    const cells = serviceDayOnly
      ? [date, dayName(date)]
      : [date, endDate ?? "", endDate ? `${dayName(date)} – ${dayName(endDate)}` : dayName(date)];
    // The description is where the speaker, topic, leader or facilitators
    // are typed (the form's Speaker Session / Group Discussion templates);
    // kept as typed, line breaks included.
    cells.push(timeText(e), e.title, e.event_type, (e.description ?? "").trim(), e.location ?? "");
    return cells.map(csvCell).join(",");
  });
  // The leading byte-order mark makes Excel read the file as UTF-8, so
  // accents and curly quotes in names and details show correctly.
  return "﻿" + [header.map(csvCell).join(","), ...lines].join("\r\n");
}
