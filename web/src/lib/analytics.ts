import { createClient } from "@/lib/supabase/server";
import { buildServantOptions, type ServantOption, type ServantRoleRow } from "@/lib/servants";
import { fetchAllRows } from "@/lib/pagination";
import { getAppSettings } from "@/lib/app-settings";
import { dateKeyInZone, shiftDateKey, todayInZone } from "@/lib/timezone";

export type MemberAnalyticsRow = {
  id: string;
  assigned_servant_id: string | null;
  is_visitor: boolean;
  join_date: string | null;
  group_id: string;
  proximity: "Local" | "Regional" | "Abroad" | "Unknown";
  gender: string | null;
  hasPhone: boolean;
  hasEmail: boolean;
  hasDob: boolean;
  hasFatherOfConfession: boolean;
  hasPhoto: boolean;
};

export type AttendanceDateRow = { memberId: string; serviceDate: string };

export type AnalyticsRawData = {
  members: MemberAnalyticsRow[];
  attendance: AttendanceDateRow[];
};

/**
 * REQUIREMENTS.md §6.7/§6.2/§8.1 -- raw per-member rows rather than pre-
 * aggregated stats, so the Analytics tab's client-side "My Assigned List"
 * toggle can recompute Data Completeness, Proximity, and Average Attendance
 * by Month from the same fetch instead of round-tripping to the server --
 * same architecture as the Dashboard's stats (lib/dashboard.ts). Proximity
 * added for the Phase H donut chart -- previously only the Dashboard had
 * this data; Analytics didn't carry it at all.
 */
export async function getAnalyticsRawData(groupId: string | string[]): Promise<AnalyticsRawData> {
  const supabase = await createClient();

  // Paged via fetchAllRows -- an unpaged `.select()` silently truncates past
  // PostgREST's 1000-row cap once the combined member count crosses it (see
  // lib/members.ts's getGroupMembers for the full story). Ordered by `id`
  // purely so paging has a stable, deterministic sort to page across.
  //
  // The attendance read is independent of the member read, so both run in
  // parallel (the attendance read used to wait for the members first).
  // Attendance is filtered by group_id(s) via a join, not `.in("member_id",
  // ids)` (owner-reported: ~900 UUIDs in one filter is a request the
  // Supabase API rejects), and ordered by id so pages can't overlap.
  const [memberRows, attendanceRows] = await Promise.all([
    fetchAllRows((from, to) => {
      let q = supabase
        .from("members")
        .select(
          "id, assigned_servant_id, is_visitor, join_date, group_id, gender, phone, email, date_of_birth, father_of_confession, photo_path, university:universities(proximity)",
        )
        .eq("status", "active")
        .order("id")
        .range(from, to);
      q = Array.isArray(groupId) ? q.in("group_id", groupId) : q.eq("group_id", groupId);
      return q;
    }),
    fetchAllRows((from, to) => {
      let q = supabase
        .from("attendance_records")
        .select("member_id, service_date, member:members!inner(group_id, status)")
        .eq("attendee_type", "member")
        .is("event_id", null) // service days only (event attendance, 0111)
        .eq("member.status", "active")
        .order("id")
        .range(from, to);
      q = Array.isArray(groupId) ? q.in("member.group_id", groupId) : q.eq("member.group_id", groupId);
      return q;
    }),
  ]);

  const members: MemberAnalyticsRow[] = (memberRows ?? []).map((m) => ({
    id: m.id,
    assigned_servant_id: m.assigned_servant_id,
    is_visitor: m.is_visitor,
    join_date: m.join_date,
    group_id: m.group_id,
    proximity: ((m.university as unknown as { proximity?: string } | null)?.proximity ?? "Unknown") as MemberAnalyticsRow["proximity"],
    gender: m.gender,
    hasPhone: !!m.phone,
    hasEmail: !!m.email,
    hasDob: !!m.date_of_birth,
    hasFatherOfConfession: !!m.father_of_confession,
    hasPhoto: !!m.photo_path,
  }));

  const attendance: AttendanceDateRow[] =
    members.length > 0 ? attendanceRows.map((r) => ({ memberId: r.member_id, serviceDate: r.service_date })) : [];

  return { members, attendance };
}

/** Servant-Youth Assignments (owner-requested 18 Oct 2026): the groups'
 * Servants. Their caseloads and the unassigned-youth count are worked out in
 * the browser from the youths getAnalyticsRawData already loaded -- two
 * requests fewer than reading them separately. Deliberately not filtered by
 * "My Assigned List" -- the point is comparing servants. */
export async function getAnalyticsServants(groupId: string | string[]): Promise<ServantOption[]> {
  const supabase = await createClient();
  let q = supabase
    .from("user_roles")
    .select("user_id, group_id, profiles(id, full_name, gender), groups(name, ladder_position, display_order)")
    .eq("role", "servant");
  q = Array.isArray(groupId) ? q.in("group_id", groupId) : q.eq("group_id", groupId);
  const { data } = await q;
  return buildServantOptions((data ?? []) as unknown as ServantRoleRow[], []);
}

/** One outreach entry, on the ministry's calendar day. */
export type OutreachAnalyticsRow = { memberId: string; servantId: string; groupId: string; date: string };

/** Servant-Youth Assignments' "Outreached Youths": the past year's outreach
 * entries for these groups' youths (the longest period offered); the
 * browser counts each servant's different youths for the period picked, so
 * changing it asks the database nothing. */
export async function getAnalyticsOutreach(groupId: string | string[]): Promise<OutreachAnalyticsRow[]> {
  const [supabase, settings] = await Promise.all([createClient(), getAppSettings()]);
  const since = shiftDateKey(todayInZone(settings.timezone), { months: -12, days: -1 });
  const rows = await fetchAllRows((from, to) => {
    let q = supabase
      .from("outreach_entries")
      .select("member_id, servant_id, occurred_at, member:members!inner(group_id)")
      .gte("occurred_at", `${since}T00:00:00Z`)
      .order("id")
      .range(from, to);
    q = Array.isArray(groupId) ? q.in("member.group_id", groupId) : q.eq("member.group_id", groupId);
    return q;
  });
  return rows.map((r) => ({
    memberId: r.member_id,
    servantId: r.servant_id,
    groupId: (r.member as unknown as { group_id: string }).group_id,
    date: dateKeyInZone(r.occurred_at, settings.timezone),
  }));
}
