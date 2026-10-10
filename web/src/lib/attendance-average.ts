import { shiftDateKey } from "@/lib/timezone";

/** Event attendance and the attendance-sheet averages (owner-approved
 * 10 Oct 2026, migration 0111). Pure, so the sheets work out each person's %
 * in the browser as the switch and the period change.
 *
 * - Service %: service days counted (days with attendance) the person was
 *   at, as before.
 * - Events %: attendance-taking events for the person's class (or the whole
 *   ministry) they were at. Events count by class, never assumed open to
 *   everyone.
 * - Both ("Overall %"): every service day and event together.
 * The period runs from the latest of: its own start, the person's join
 * date and the day the ministry started using the app. Never a service
 * year. */

export type AvgMode = "service" | "events" | "both";
export type AvgPeriodKind = "3" | "6" | "12" | "custom";
export type AvgChoice = { mode: AvgMode; period: AvgPeriodKind; from: string; to: string };

export const AVG_MODES: { value: AvgMode; label: string; column: string }[] = [
  { value: "service", label: "Service", column: "Service %" },
  { value: "events", label: "Events", column: "Events %" },
  { value: "both", label: "Both", column: "Overall %" },
];

export const AVG_PERIODS: { value: AvgPeriodKind; label: string }[] = [
  { value: "12", label: "Last 12 months" },
  { value: "3", label: "Last 3 months" },
  { value: "6", label: "Last 6 months" },
  { value: "custom", label: "Custom" },
];

/** An attendance-taking event, as the sheets see it. */
export type AttendanceEvent = {
  id: string;
  /** First day (what the Date list shows). */
  date: string;
  endDate: string;
  title: string;
  /** null = the whole ministry; else the classes it's for. */
  groupIds: string[] | null;
  /** Over, or someone already has attendance for it -- only then does it
   * count toward anyone's Events %. */
  held: boolean;
};

export function defaultAvgChoice(today: string): AvgChoice {
  return { mode: "service", period: "12", from: shiftDateKey(today, { months: -12 }), to: today };
}

/** The period's own first and last day. */
export function periodBounds(choice: AvgChoice, today: string): { from: string; to: string } {
  if (choice.period === "custom") return { from: choice.from || today, to: choice.to || today };
  return { from: shiftDateKey(today, { months: -Number(choice.period) }), to: today };
}

/** Is the event for anyone in these classes? An empty list (a servant
 * with no class, or a General Coordinator) only gets whole-ministry
 * events. */
export function eventIsFor(event: AttendanceEvent, groupIds: string[]): boolean {
  return event.groupIds === null || event.groupIds.some((g) => groupIds.includes(g));
}

/** One line of the attendance-history pop-up. */
export type HistoryRow = { date: string; present: boolean; label?: string };

/**
 * A person's % and the lines it was worked out from (for the pop-up).
 * `serviceDates`: ascending service days counted for their list.
 * `presentDates`: service days they were at. `events`: every attendance
 * event; `presentEvents`: the ones they were at. Null when there's nothing
 * to count yet (never attended, or nothing in the period).
 */
export function averageFor(args: {
  choice: AvgChoice;
  today: string;
  joinDate: string | null;
  usingAppSince: string | null;
  groupIds: string[];
  serviceDates: string[];
  presentDates: ReadonlySet<string>;
  events: AttendanceEvent[];
  presentEvents: ReadonlySet<string>;
}): { percent: number | null; rows: HistoryRow[] } {
  const { choice, today, usingAppSince, groupIds, serviceDates, presentDates, events, presentEvents } = args;
  // Marking someone present before their join date moves their join date
  // back (as the database does), so count from the earliest of the two.
  let joinDate = args.joinDate;
  for (const d of presentDates) if (!joinDate || d < joinDate) joinDate = d;
  for (const e of events) if (presentEvents.has(e.id) && (!joinDate || e.date < joinDate)) joinDate = e.date;
  if (!joinDate) return { percent: null, rows: [] };

  const bounds = periodBounds(choice, today);
  let since = bounds.from;
  if (joinDate > since) since = joinDate;
  if (usingAppSince && usingAppSince > since) since = usingAppSince;
  const until = bounds.to;

  const rows: HistoryRow[] = [];
  if (choice.mode !== "events") {
    for (const d of serviceDates) if (d >= since && d <= until) rows.push({ date: d, present: presentDates.has(d) });
  }
  if (choice.mode !== "service") {
    for (const e of events) {
      if (e.date < since || e.date > until) continue;
      const present = presentEvents.has(e.id);
      if (present || (e.held && eventIsFor(e, groupIds))) rows.push({ date: e.date, present, label: e.title });
    }
  }
  if (rows.length === 0) return { percent: null, rows };
  return { percent: Math.round((rows.filter((r) => r.present).length / rows.length) * 100), rows };
}

/** "Fri, Oct 9, 2026" -- the Date list and the pop-up. */
export function formatSheetDate(iso: string): string {
  const [y, m, d] = iso.split("-").map(Number);
  return new Date(y, m - 1, d).toLocaleDateString(undefined, {
    weekday: "short",
    month: "short",
    day: "numeric",
    year: "numeric",
  });
}

/** The saved choice (see useAvgChoice), checked field by field. */
export function parseAvgChoice(raw: string, today: string): AvgChoice {
  const fallback = defaultAvgChoice(today);
  try {
    const saved = JSON.parse(raw) as Partial<AvgChoice>;
    return {
      mode: AVG_MODES.some((m) => m.value === saved.mode) ? (saved.mode as AvgMode) : fallback.mode,
      period: AVG_PERIODS.some((p) => p.value === saved.period) ? (saved.period as AvgPeriodKind) : fallback.period,
      from: typeof saved.from === "string" && saved.from ? saved.from : fallback.from,
      to: typeof saved.to === "string" && saved.to ? saved.to : fallback.to,
    };
  } catch {
    return fallback;
  }
}

export function serializeAvgChoice(choice: AvgChoice): string {
  return JSON.stringify(choice);
}
