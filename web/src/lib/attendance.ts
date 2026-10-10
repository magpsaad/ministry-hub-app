import { createClient } from "@/lib/supabase/server";
import { getAppSettings, getAttendanceWindowSettings, isOnServiceWeekday } from "@/lib/app-settings";
import type { AttendanceEvent } from "@/lib/attendance-average";
import { nowInZone } from "@/lib/timezone";
import { fetchAllRows } from "@/lib/pagination";

export type AttendanceMemberBase = {
  id: string;
  group_id: string;
  full_name: string;
  is_visitor: boolean;
  assigned_servant_id: string | null;
  proximity: "Local" | "Regional" | "Abroad" | "Unknown";
  join_date: string | null;
};

export type AttendanceBundle = {
  members: AttendanceMemberBase[];
  /** member id -> every service day they were present for */
  attendanceByMember: Record<string, string[]>;
  /** member id -> every attendance event they were at (migration 0111) */
  eventsByMember: Record<string, string[]>;
  /** Attendance-taking events for these groups that have started,
   * oldest first. */
  events: AttendanceEvent[];
  trackedDates: string[]; // service days, descending, most recent first
  /** Ascending, service-weekday-only dates -- the service days the
   * average % counts (lib/attendance-average.ts, worked out in the browser
   * for the chosen switch and period). */
  serviceWeekdayDates: string[];
  usingAppSince: string | null;
  todayDate: string;
  todayAvailable: boolean;
};


function toMinutes(hms: string): number {
  const [h, m] = hms.split(":").map(Number);
  return h * 60 + m;
}

/**
 * Everything the Attendance tab needs in one pass: the member roster
 * (with proximity/visitor/assignment flags), every attendance row for
 * those members, and the date-picker's derived options -- fetched once,
 * up front, so switching the selected date is a pure client-side
 * recomputation (REQUIREMENTS.md §6.5) instead of a fresh server round
 * trip per date, and so members/attendance aren't fetched twice over
 * (previously one query each inside getAttendanceDates and again inside
 * getAttendanceForDate).
 *
 * "Today" becomes available once EITHER someone has already checked in
 * today OR the configured same-day cutoff has passed, whichever happens
 * first (§7.2).
 */
export async function getAttendanceBundle(groupId: string | string[]): Promise<AttendanceBundle> {
  const supabase = await createClient();

  // Paged via fetchAllRows -- an unpaged `.select()` silently truncates past
  // PostgREST's 1000-row cap (owner-reported: the combined Youth List and
  // its sibling tabs, this one included, all fetch every active member the
  // same unpaged way -- see lib/members.ts's getGroupMembers for the full
  // story). `id` breaks ties on full_name so paging can't skip/duplicate a row.
  const groupIds = Array.isArray(groupId) ? groupId : [groupId];
  const [settings, memberRows, windowSettings, attendance, { data: eventRows }] = await Promise.all([
    getAppSettings(),
    fetchAllRows((from, to) => {
      let q = supabase
        .from("members")
        .select("id, group_id, full_name, is_visitor, assigned_servant_id, join_date, university:universities(proximity)")
        .eq("status", "active")
        .order("full_name")
        .order("id")
        .range(from, to);
      q = Array.isArray(groupId) ? q.in("group_id", groupId) : q.eq("group_id", groupId);
      return q;
    }),
    getAttendanceWindowSettings(),
    // Filtered by group_id(s) via a join, not `.in("member_id", ids)` with
    // every id from a potentially large member list (owner-reported: ~900
    // UUIDs in one filter is a request the Supabase API rejects). Independent
    // of the members read, so fetched in the same parallel batch. Paged and
    // ordered by id so pages can't overlap or skip rows.
    fetchAllRows((from, to) => {
      let q = supabase
        .from("attendance_records")
        .select("member_id, service_date, event_id, member:members!inner(group_id, status)")
        .eq("attendee_type", "member")
        .eq("member.status", "active")
        .order("id")
        .range(from, to);
      q = Array.isArray(groupId) ? q.in("member.group_id", groupId) : q.eq("member.group_id", groupId);
      return q;
    }),
    supabase
      .from("service_calendar_events")
      .select("id, title, start_date, end_date, audience, audience_group_ids")
      .eq("take_attendance", true)
      .order("start_date"),
  ]);

  const cutoff = settings.same_day_cutoff_time;
  const { date: todayDate, timeMinutes } = nowInZone(settings.timezone);

  const members: AttendanceMemberBase[] = (memberRows ?? []).map((m) => ({
    id: m.id,
    group_id: m.group_id,
    full_name: m.full_name,
    is_visitor: m.is_visitor,
    assigned_servant_id: m.assigned_servant_id,
    join_date: m.join_date,
    proximity: ((m.university as unknown as { proximity?: string } | null)?.proximity ??
      "Unknown") as AttendanceMemberBase["proximity"],
  }));

  const attendanceByMember: Record<string, string[]> = {};
  const eventsByMember: Record<string, string[]> = {};
  const trackedDatesSet = new Set<string>();
  const eventsWithRows = new Set<string>();

  if (members.length > 0) {
    for (const row of attendance) {
      if (row.event_id) {
        (eventsByMember[row.member_id] ??= []).push(row.event_id);
        eventsWithRows.add(row.event_id);
        continue;
      }
      (attendanceByMember[row.member_id] ??= []).push(row.service_date);
      trackedDatesSet.add(row.service_date);
    }
  }

  // Events for these groups (or the whole ministry) that have started.
  const events: AttendanceEvent[] = (eventRows ?? [])
    .filter((e) => e.start_date <= todayDate)
    .filter((e) => e.audience === "all" || (e.audience_group_ids as string[]).some((g) => groupIds.includes(g)))
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
  // Same fix as the servants' equivalent (lib/servant-attendance.ts,
  // owner-reported there) -- this was purely time-of-day before, with no
  // check that today is actually the configured service day.
  const cutoffPassed = isOnServiceWeekday(todayDate, windowSettings.service_weekday) && timeMinutes >= toMinutes(cutoff);

  // Only service-weekday dates count toward average attendance % (and the
  // weekly-breakdown modal, which lists exactly this set) -- `trackedDates`
  // above still shows every date, including off-day special events, for the
  // date-picker (REQUIREMENTS.md §6.5).
  const serviceWeekdayDates = Array.from(trackedDatesSet)
    .filter((d) => isOnServiceWeekday(d, windowSettings.service_weekday))
    .sort();

  return {
    members,
    attendanceByMember,
    eventsByMember,
    events,
    trackedDates,
    serviceWeekdayDates,
    usingAppSince: settings.using_app_since,
    todayDate,
    todayAvailable: todayHasRows || cutoffPassed,
  };
}
