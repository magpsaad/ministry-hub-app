export type CalendarEventType = "Trip" | "Outing" | "Group Discussion" | "Speaker Session" | "Event" | "Holiday";

export type CalendarEvent = {
  id: string;
  title: string;
  description: string | null;
  event_type: CalendarEventType;
  start_date: string;
  end_date: string;
  all_day: boolean;
  start_time: string | null;
  end_time: string | null;
  location: string | null;
  attachment_url: string | null;
  created_by: string;
  /** Migration 0111 -- attendance is taken (Events, Trips, Outings), and
   * for whom: the whole ministry, grades (levels) or chosen classes. The
   * classes are kept in audience_group_ids either way. */
  take_attendance: boolean;
  audience: EventAudience;
  audience_levels: number[];
  audience_group_ids: string[];
};

export type EventAudience = "all" | "grade" | "class";

/** Only these types can take attendance (owner-approved 10 Oct 2026). */
export const ATTENDANCE_EVENT_TYPES: CalendarEventType[] = ["Event", "Trip", "Outing"];

/** What the event form needs for "Take attendance": whether this person
 * may set it (Coordinators, General Coordinators, Admins) and the grades
 * and classes to choose from. */
export type EventAttendanceOptions = {
  canSet: boolean;
  /** The ministry's own words (owner-requested): the level word ("Yr",
   * "Gr") and the group word ("Cohort", "Group"). */
  positionLabel: string;
  groupLabel: string;
  grades: { level: number; label: string }[];
  classes: { id: string; name: string }[];
};

/** REQUIREMENTS.md §6.8 -- exact colors pulled from the current app's own
 * source (JavaScript.html's CALENDAR_EVENT_TYPES), not guessed. */
export const EVENT_TYPE_COLORS: Record<CalendarEventType, { color: string; bg: string }> = {
  Trip: { color: "#FF6B6B", bg: "#FFE5E5" },
  Outing: { color: "#36F1CD", bg: "#E0F7F5" },
  "Group Discussion": { color: "#020887", bg: "#D6E3F0" },
  "Speaker Session": { color: "#39A0ED", bg: "#E0F2F8" },
  Event: { color: "#9C27B0", bg: "#F3E5F5" },
  Holiday: { color: "#98D8C8", bg: "#E8F8F5" },
};

export const EVENT_TYPES: CalendarEventType[] = [
  "Trip",
  "Outing",
  "Group Discussion",
  "Speaker Session",
  "Event",
  "Holiday",
];

/** `color` is the solid pill/badge background (confirmed correct usage
 * against the old app's actual look); text color is computed for
 * contrast rather than hardcoded, since some of these hexes are light
 * (e.g. Outing's `#36F1CD`) and others dark. */
export function contrastText(hex: string): string {
  const r = parseInt(hex.slice(1, 3), 16);
  const g = parseInt(hex.slice(3, 5), 16);
  const b = parseInt(hex.slice(5, 7), 16);
  const luminance = (0.299 * r + 0.587 * g + 0.114 * b) / 255;
  return luminance > 0.6 ? "#000000" : "#FFFFFF";
}
