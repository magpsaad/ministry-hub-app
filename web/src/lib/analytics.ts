import { createClient } from "@/lib/supabase/server";
import { getServantsForGroup, type ServantOption } from "@/lib/servants";
import { fetchAllRows } from "@/lib/pagination";

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

export type ServantAssignments = {
  servants: ServantOption[];
  unassignedCount: number;
};

/** REQUIREMENTS.md §6.7 -- every servant (female before male, then
 * alphabetically), with an unassigned-members total row. Deliberately not
 * filtered by "My Assigned List" -- this table's whole point is comparing
 * caseloads *across* servants, which "just mine" doesn't meaningfully apply to. */
export async function getServantAssignments(groupId: string | string[]): Promise<ServantAssignments> {
  const supabase = await createClient();

  let query = supabase.from("members").select("id", { count: "exact", head: true }).eq("status", "active").is("assigned_servant_id", null);
  query = Array.isArray(groupId) ? query.in("group_id", groupId) : query.eq("group_id", groupId);
  // Independent reads -- run in parallel (they used to be sequential).
  const [servants, { count }] = await Promise.all([getServantsForGroup(groupId), query]);

  return { servants, unassignedCount: count ?? 0 };
}
