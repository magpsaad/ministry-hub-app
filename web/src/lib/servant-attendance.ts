import { createClient } from "@/lib/supabase/server";
import { fetchAllRows } from "@/lib/pagination";
import { getAppSettings, getAttendanceWindowSettings, resolveAttendanceSince, isOnServiceWeekday } from "@/lib/app-settings";
import { nowInZone } from "@/lib/timezone";

export type ServantAttendanceMember = {
  id: string;
  full_name: string;
  groupLabel: string; // serving group name, "General Coordinator", or "Unassigned"
  join_date: string | null;
  averageAttendance: number | null; // rolling window, floored at join_date
};

export type ServantAttendanceBundle = {
  members: ServantAttendanceMember[];
  attendanceByServant: Record<string, string[]>;
  trackedDates: string[];
  /** Ascending, service-weekday-only dates -- same set `averageAttendance`
   * is computed from; the click-to-view weekly-breakdown modal (owner-
   * requested) lists exactly this set per person, client-side. */
  serviceWeekdayDates: string[];
  windowWeeks: number | null;
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
 * Average attendance % uses the same rolling-window-floored-at-join_date
 * rule as Servant Directory (`servant_attendance_window_weeks`). */
export async function getServantAttendanceBundle(): Promise<ServantAttendanceBundle> {
  const supabase = await createClient();

  const [settings, { data: roleRows }, windowSettings] = await Promise.all([
    getAppSettings(),
    supabase
      .from("user_roles")
      .select("user_id, role, group_id, groups(name), profiles(full_name, join_date)")
      .in("role", ["servant", "general_coordinator"]),
    getAttendanceWindowSettings(),
  ]);

  const cutoff = settings.same_day_cutoff_time;
  const { date: todayDate, timeMinutes } = nowInZone(settings.timezone);

  const byUser = new Map<string, { full_name: string; join_date: string | null; groupLabel: string }>();
  for (const r of roleRows ?? []) {
    if (byUser.has(r.user_id)) continue;
    const profile = r.profiles as unknown as { full_name: string; join_date: string | null } | null;
    if (!profile) continue;
    const groupName = (r.groups as unknown as { name: string } | null)?.name;
    const groupLabel = r.role === "general_coordinator" ? "General Coordinator" : (groupName ?? "Unassigned");
    byUser.set(r.user_id, { full_name: profile.full_name, join_date: profile.join_date, groupLabel });
  }

  const ids = Array.from(byUser.keys());

  const attendanceByServant: Record<string, string[]> = {};
  const trackedDatesSet = new Set<string>();

  if (ids.length > 0) {
    // Paged: all-time servant attendance passes PostgREST's 1000-row cap
    // (822 rows in QA already).
    const attendance = await fetchAllRows((from, to) =>
      supabase
        .from("attendance_records")
        .select("servant_id, service_date")
        .eq("attendee_type", "servant")
        .in("servant_id", ids)
        .order("id")
        .range(from, to),
    );

    for (const row of attendance) {
      (attendanceByServant[row.servant_id] ??= []).push(row.service_date);
      trackedDatesSet.add(row.service_date);
    }
  }

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
    const since = resolveAttendanceSince(info.join_date, windowSettings.servant_attendance_window_weeks, windowSettings.timezone);
    if (!since) {
      return { id, full_name: info.full_name, groupLabel: info.groupLabel, join_date: info.join_date, averageAttendance: null };
    }

    const relevantDates = allDates.filter((d) => d >= since);
    const presentSet = new Set(attendanceByServant[id] ?? []);
    const averageAttendance =
      relevantDates.length > 0
        ? Math.round((relevantDates.filter((d) => presentSet.has(d)).length / relevantDates.length) * 100)
        : null;
    return { id, full_name: info.full_name, groupLabel: info.groupLabel, join_date: info.join_date, averageAttendance };
  });
  members.sort((a, b) => a.full_name.localeCompare(b.full_name));

  return {
    members,
    attendanceByServant,
    trackedDates,
    serviceWeekdayDates: allDates.slice().sort(),
    windowWeeks: windowSettings.servant_attendance_window_weeks,
    todayDate,
    todayAvailable: todayHasRows || cutoffPassed,
  };
}
