import { shiftDateKey, zoneLocalToUtc } from "@/lib/timezone";

/** The Service Calendar as an iCalendar (.ics) feed (migration 0107) -- what
 * Google / Apple / Outlook Calendar read from a person's private link.
 * Minimal on purpose: title, type, dates, times and place only. */

export type FeedEvent = {
  id: string;
  title: string;
  type: string;
  start_date: string;
  end_date: string;
  all_day: boolean;
  start_time: string | null;
  end_time: string | null;
  location: string | null;
};

export type Feed = { title: string; timezone: string; events: FeedEvent[] };

/** RFC 5545 text: backslash, semicolon, comma and line breaks escaped. */
function text(value: string): string {
  return value.replace(/\\/g, "\\\\").replace(/;/g, "\\;").replace(/,/g, "\\,").replace(/\r?\n/g, "\\n");
}

/** Lines longer than 75 bytes are folded (continuation lines start with a space). */
function fold(line: string): string {
  const bytes = new TextEncoder().encode(line);
  if (bytes.length <= 75) return line;
  const parts: string[] = [];
  let current = "";
  let size = 0;
  for (const ch of line) {
    const n = new TextEncoder().encode(ch).length;
    if (size + n > (parts.length === 0 ? 75 : 74)) {
      parts.push(current);
      current = "";
      size = 0;
    }
    current += ch;
    size += n;
  }
  parts.push(current);
  return parts.join("\r\n ");
}

const utcStamp = (d: Date) => d.toISOString().replace(/[-:]/g, "").replace(/\.\d{3}Z$/, "Z");
const dateValue = (key: string) => key.slice(0, 10).replace(/-/g, "");

/** Imported holidays are stored as 00:00-23:59 rather than "all day". */
function isAllDay(e: FeedEvent): boolean {
  if (e.all_day || !e.start_time) return true;
  return e.start_time.startsWith("00:00") && (e.end_time ?? "").startsWith("23:59");
}

export function buildIcs(feed: Feed, host: string, now = new Date()): string {
  const lines: string[] = [
    "BEGIN:VCALENDAR",
    "VERSION:2.0",
    "PRODID:-//Ministry Hub//Service Calendar//EN",
    "CALSCALE:GREGORIAN",
    "METHOD:PUBLISH",
    `X-WR-CALNAME:${text(`${feed.title} Service Calendar`)}`,
    `X-WR-TIMEZONE:${feed.timezone}`,
    // Ask calendar apps to check about hourly (Google decides for itself).
    "REFRESH-INTERVAL;VALUE=DURATION:PT1H",
    "X-PUBLISHED-TTL:PT1H",
  ];
  const stamp = utcStamp(now);
  for (const e of feed.events) {
    lines.push("BEGIN:VEVENT", `UID:${e.id}@${host}`, `DTSTAMP:${stamp}`, `SUMMARY:${text(e.title)}`, `CATEGORIES:${text(e.type)}`);
    if (isAllDay(e)) {
      lines.push(`DTSTART;VALUE=DATE:${dateValue(e.start_date)}`);
      // All-day ends are exclusive: the day after the last day.
      lines.push(`DTEND;VALUE=DATE:${dateValue(shiftDateKey(e.end_date.slice(0, 10), { days: 1 }))}`);
    } else {
      const start = zoneLocalToUtc(e.start_date.slice(0, 10), e.start_time!, feed.timezone);
      let end = zoneLocalToUtc(e.end_date.slice(0, 10), e.end_time ?? e.start_time!, feed.timezone);
      if (end.getTime() <= start.getTime()) end = new Date(start.getTime() + 60 * 60 * 1000);
      lines.push(`DTSTART:${utcStamp(start)}`, `DTEND:${utcStamp(end)}`);
    }
    if (e.location?.trim()) lines.push(`LOCATION:${text(e.location.trim())}`);
    lines.push("END:VEVENT");
  }
  lines.push("END:VCALENDAR");
  return lines.map(fold).join("\r\n") + "\r\n";
}
