import { createClient } from "@/lib/supabase/server";
import { fetchAllRows } from "@/lib/pagination";
import { getAppSettings, getAttendanceWindowSettings, isOnServiceWeekday } from "@/lib/app-settings";
import type { AttendanceEvent } from "@/lib/attendance-average";
import { nowInZone } from "@/lib/timezone";
import { getRoleLabels } from "@/lib/role-labels-server";

export type ServantAttendanceMember = {
  id: string;
  full_name: string;
  groupLabel: string; // serving group name, "General Coordinator", or "Unassigned"
  join_date: string | null;
  /** The classes they serve -- which events count toward their Events %
   * (none: whole-ministry events only). */
  groupIds: string[];
  /** A General Coordinator with no Servant or Coordinator grant (not
   * counted in the weekly strip, owner-requested 15 Oct 2026). */
  gcOnly: boolean;
  /** Holds a Coordinator (HSY: Steward) grant -- listed with a chip
   * (owner-requested 15 Oct 2026; HSY Stewards without a Servant grant
   * used to be missing from this list). */
  isCoordinator: boolean;
  /** Counted in the weekly strip from this day: when they joined (their
   * first attendance), else when they signed up. */
  countFrom: string | null;
};

export type ServantAttendanceBundle = {
  members: ServantAttendanceMember[];
  /** group id -> name, for the weekly strip's per-group rows */
  groupNames: Record<string, string>;
  /** servant id -> service days they were at */
  attendanceByServant: Record<string, string[]>;
  /** servant id -> attendance events they were at (migration 0111) */
  eventsByServant: Record<string, string[]>;
  /** Every attendance-taking event that has started, oldest first. */
  events: AttendanceEvent[];
  trackedDates: string[];
  /** Ascending, service-weekday-only dates -- the service days the
   * average % counts (lib/attendance-average.ts, in the browser). */
  serviceWeekdayDates: string[];
  usingAppSince: string | null;
  todayDate: string;
  todayAvailable: boolean;
};


function toMinutes(hms: string): number {
  const [h, m] = hms.split(":").map(Number);
  return h * 60 + m;
}

/** REQUIREMENTS.md §6.13 -- same Present/Absent pattern as member attendance
 * (§6.5), applied to servants. Visible to Coordinator Corner (any
 * coordinator tier, per the widened RLS in migration 0022), not scoped to
 * one group -- every servant across the whole ministry shows on one list.
 * The average % is worked out in the browser for the chosen Service /
 * Events / Both and period (owner-approved 10 Oct 2026). */
export async function getServantAttendanceBundle(): Promise<ServantAttendanceBundle> {
  const supabase = await createClient();

  const [settings, { data: roleRows }, windowSettings, L, { data: eventRows }] = await Promise.all([
    getAppSettings(),
    supabase
      .from("user_roles")
      .select("user_id, role, group_id, groups(name, display_order), profiles(full_name, join_date, created_at)")
      .in("role", ["servant", "sub_coordinator", "general_coordinator"]),
    getAttendanceWindowSettings(),
    getRoleLabels(),
    supabase
      .from("service_calendar_events")
      .select("id, title, start_date, end_date, audience, audience_group_ids")
      .eq("take_attendance", true)
      .order("start_date"),
  ]);

  const cutoff = settings.same_day_cutoff_time;
  const { date: todayDate, timeMinutes } = nowInZone(settings.timezone);

  const byUser = new Map<string, { full_name: string; join_date: string | null; countFrom: string | null }>();
  const groupsByUser = new Map<string, string[]>();
  const groupNameById = new Map<string, string>();
  const servantGrant = new Set<string>();
  const coordinatorGrant = new Set<string>();
  const gcGrant = new Set<string>();
  const groupOrder: { id: string; name: string; order: number }[] = [];
  for (const r of roleRows ?? []) {
    const group = r.groups as unknown as { name: string; display_order: number | null } | null;
    if (r.role === "servant") servantGrant.add(r.user_id);
    if (r.role === "sub_coordinator") coordinatorGrant.add(r.user_id);
    if (r.role === "general_coordinator") gcGrant.add(r.user_id);
    if (r.role !== "general_coordinator" && r.group_id && group) {
      // Servants and Coordinators alike: the groups they serve.
      const list = groupsByUser.get(r.user_id) ?? [];
      if (!list.includes(r.group_id)) groupsByUser.set(r.user_id, [...list, r.group_id]);
      groupNameById.set(r.group_id, group.name);
      if (!groupOrder.some((g) => g.id === r.group_id)) groupOrder.push({ id: r.group_id, name: group.name, order: group.display_order ?? 0 });
    }
    if (byUser.has(r.user_id)) continue;
    const profile = r.profiles as unknown as { full_name: string; join_date: string | null; created_at: string | null } | null;
    if (!profile) continue;
    byUser.set(r.user_id, {
      full_name: profile.full_name,
      join_date: profile.join_date,
      countFrom: profile.join_date ?? profile.created_at?.slice(0, 10) ?? null,
    });
  }
  // Their group's name; else General Coordinator; else Unassigned.
  const groupLabelOf = (id: string) => {
    const first = groupsByUser.get(id)?.[0];
    if (first) return groupNameById.get(first) ?? "Unassigned";
    return gcGrant.has(id) ? L.generalCoordinator : "Unassigned";
  };
  groupOrder.sort((a, b) => a.order - b.order || a.name.localeCompare(b.name));
  const groupNames = Object.fromEntries(groupOrder.map((g) => [g.id, g.name]));

  const ids = Array.from(byUser.keys());

  const attendanceByServant: Record<string, string[]> = {};
  const eventsByServant: Record<string, string[]> = {};
  const trackedDatesSet = new Set<string>();
  const eventsWithRows = new Set<string>();

  if (ids.length > 0) {
    // Paged: all-time servant attendance passes PostgREST's 1000-row cap
    // (822 rows in QA already).
    const attendance = await fetchAllRows((from, to) =>
      supabase
        .from("attendance_records")
        .select("servant_id, service_date, event_id")
        .eq("attendee_type", "servant")
        .in("servant_id", ids)
        .order("id")
        .range(from, to),
    );

    for (const row of attendance) {
      if (row.event_id) {
        (eventsByServant[row.servant_id] ??= []).push(row.event_id);
        eventsWithRows.add(row.event_id);
        continue;
      }
      (attendanceByServant[row.servant_id] ??= []).push(row.service_date);
      trackedDatesSet.add(row.service_date);
    }
  }

  const events: AttendanceEvent[] = (eventRows ?? [])
    .filter((e) => e.start_date <= todayDate)
    .map((e) => ({
      id: e.id,
      date: e.start_date,
      endDate: e.end_date,
      title: e.title,
      groupIds: e.audience === "all" ? null : (e.audience_group_ids as string[]),
      held: e.end_date < todayDate || eventsWithRows.has(e.id),
    }));

  const trackedDates = Array.from(trackedDatesSet).sort((a, b) => (a < b ? 1 : -1));
  const todayHasRows = trackedDatesSet.has(todayDate);
  // Owner-reported: the date-picker was defaulting to today even on days
  // that aren't the configured service day at all -- `cutoffPassed` was
  // purely time-of-day (past 9pm), with no check that today is actually a
  // service day. It's only meant to open up "today" early, before any
  // check-ins exist yet, on an actual service day.
  const cutoffPassed = isOnServiceWeekday(todayDate, windowSettings.service_weekday) && timeMinutes >= toMinutes(cutoff);

  // Only service-weekday dates count toward average attendance % -- the
  // date-picker (`trackedDates`, above) still shows every date, including
  // off-day special events, since a servant can deliberately record
  // attendance for those (REQUIREMENTS.md §6.5); they just shouldn't move
  // this percentage.
  const allDates = Array.from(trackedDatesSet).filter((d) => isOnServiceWeekday(d, windowSettings.service_weekday));

  const members: ServantAttendanceMember[] = ids.map((id) => {
    const info = byUser.get(id)!;
    return {
      id,
      ...info,
      groupLabel: groupLabelOf(id),
      groupIds: groupsByUser.get(id) ?? [],
      gcOnly: !servantGrant.has(id) && !coordinatorGrant.has(id),
      isCoordinator: coordinatorGrant.has(id),
    };
  });
  members.sort((a, b) => a.full_name.localeCompare(b.full_name));

  return {
    members,
    groupNames,
    attendanceByServant,
    eventsByServant,
    events,
    trackedDates,
    serviceWeekdayDates: allDates.slice().sort(),
    usingAppSince: settings.using_app_since,
    todayDate,
    todayAvailable: todayHasRows || cutoffPassed,
  };
}
