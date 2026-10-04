import { createClient } from "@/lib/supabase/server";
import { getAttendanceWindowSettings, resolveAttendanceSince, isOnServiceWeekday } from "@/lib/app-settings";
import { fetchAllRows } from "@/lib/pagination";
import { getAppSettings } from "@/lib/app-settings";
import { PARENT_COLUMNS, pickParents, type ParentContacts } from "@/lib/parent-contacts";

export type MemberListItem = {
  id: string;
  full_name: string;
  phone: string | null;
  photo_path: string | null;
  program_of_study: string | null;
  is_visitor: boolean;
  gender: string | null;
  date_of_birth: string | null;
  assigned_servant_id: string | null;
  join_date: string | null;
  group_id: string;
  group: { id: string; name: string } | null;
  university: { id: string; name: string; proximity: string } | null;
  assigned_servant: { full_name: string } | null;
  avgAttendancePercent: number | null;
};

export type MemberDetail = MemberListItem & {
  email: string | null;
  university_id: string | null;
  date_of_birth: string | null;
  father_of_confession: string | null;
  home_address: string | null;
  registration_comments: string | null;
  servant_comments: string | null;
  /** Migration 0087 -- null when this ministry doesn't keep parents'
   * contact details (Ministry Settings), so nothing about them shows. */
  parents: ParentContacts | null;
};

export type GroupMembersResult = {
  members: MemberListItem[];
  /** Ascending service-weekday dates with any attendance in the loaded
   * cohort(s) -- the exact set each member's average-attendance % above was
   * divided over. Handed to the client so a card's click-to-view attendance
   * history (owner-requested) lists precisely the dates behind that number,
   * needing only that one member's own present-dates fetched on demand. */
  serviceWeekdayDates: string[];
};

/** Client-side filter shape -- REQUIREMENTS.md §6.4's filter panel now
 * filters live in the browser (item 21/24d) rather than round-tripping to
 * the server per keystroke/checkbox, so this type is consumed by the
 * client component, not applied here. */
export type MemberFilters = {
  q?: string;
  servantIds?: string[]; // may include the literal "unassigned"
  universityIds?: string[];
  excludeVisitors?: boolean;
  hasPhoto?: boolean;
  male?: boolean;
  female?: boolean;
  proximities?: string[]; // Local | Regional | Abroad | Unknown
  myAssignedOnly?: boolean;
};

const LIST_SELECT =
  "id, full_name, phone, photo_path, program_of_study, is_visitor, gender, date_of_birth, assigned_servant_id, join_date, group_id, group:groups(id, name), university:universities(id, name, proximity), assigned_servant:profiles(full_name)";

/**
 * Every active member of a group, with a computed average-attendance % per
 * REQUIREMENTS.md §6.4/§7.2's corrected formula: present dates / tracked
 * dates since the member's `join_date` (their earliest attendance record --
 * §3.3, distinct from `created_at`, which is just when the row was
 * inserted and would read wrong for migrated data), capped to a rolling
 * window (`youth_attendance_window_weeks`, admin-configurable). Only counts
 * dates on the configured service weekday (Friday by default) -- an
 * off-day attendance row (a retreat, a trip) stays visible everywhere else,
 * it just doesn't move this percentage. Returns null (not 0%) when there's
 * no tracked date yet to divide by, including when the member has never
 * attended at all (join_date is null).
 *
 * `groupId` accepts an array for the "Load Youth Data for all cohorts"
 * combined view (REQUIREMENTS.md §6.1 addendum) -- every active member
 * across those cohorts, combined into one list.
 */
export async function getGroupMembers(groupId: string | string[]): Promise<GroupMembersResult> {
  const supabase = await createClient();

  // Owner-reported: the "all cohorts combined" Youth List showed exactly
  // 1000 -- PostgREST's configured db-max-rows for this project (see
  // lib/pagination.ts) -- when the real combined total was 1012. A single
  // unpaged `.select()` silently truncates past that cap; paged via
  // fetchAllRows like the attendance query below already was. Ties on
  // full_name alone aren't safe to page across (could skip or duplicate a
  // row at a page boundary), so `id` is added as a deterministic tiebreaker.
  //
  // The attendance read below is independent of the member read, so all
  // three run in one parallel batch (the attendance read used to wait for
  // the members first -- an extra round trip per page of attendance).
  const [data, windowSettings, attendance] = await Promise.all([
    fetchAllRows((from, to) => {
      let q = supabase.from("members").select(LIST_SELECT).eq("status", "active").order("full_name").order("id").range(from, to);
      q = Array.isArray(groupId) ? q.in("group_id", groupId) : q.eq("group_id", groupId);
      return q;
    }),
    getAttendanceWindowSettings(),
    // Filtered by the same group_id(s)/active-status as the members query,
    // via a join -- NOT `.in("member_id", memberIds)` with every id from a
    // large member list. That silently broke the "all cohorts combined" view
    // (owner-reported: ~900 UUIDs in one filter is a request the Supabase API
    // rejects with a 400). A group_id filter stays small regardless of how
    // many members it resolves to. Paged via fetchAllRows, ordered by id so
    // pages can't overlap or skip rows.
    fetchAllRows((from, to) => {
      let q = supabase
        .from("attendance_records")
        .select("member_id, service_date, member:members!inner(group_id, status)")
        .eq("attendee_type", "member")
        .eq("member.status", "active")
        .order("id")
        .range(from, to);
      q = Array.isArray(groupId) ? q.in("member.group_id", groupId) : q.eq("member.group_id", groupId);
      return q;
    }),
  ]);

  const members = data as unknown as MemberListItem[];
  if (members.length === 0) return { members: [], serviceWeekdayDates: [] };

  const trackedDates = Array.from(new Set(attendance.map((a) => a.service_date)))
    .filter((d) => isOnServiceWeekday(d, windowSettings.service_weekday))
    .sort();
  const presentByMember = new Map<string, Set<string>>();
  for (const a of attendance) {
    if (!a.member_id) continue;
    if (!presentByMember.has(a.member_id)) presentByMember.set(a.member_id, new Set());
    presentByMember.get(a.member_id)!.add(a.service_date);
  }

  const membersWithAttendance = members.map((m) => {
    const since = resolveAttendanceSince(m.join_date, windowSettings.youth_attendance_window_weeks);
    if (!since) return { ...m, avgAttendancePercent: null };

    const trackedInWindow = trackedDates.filter((d) => d >= since);
    const presentSet = presentByMember.get(m.id) ?? new Set<string>();
    const presentCount = trackedInWindow.filter((d) => presentSet.has(d)).length;
    const avgAttendancePercent =
      trackedInWindow.length > 0 ? Math.round((presentCount / trackedInWindow.length) * 100) : null;

    return { ...m, avgAttendancePercent };
  });

  return { members: membersWithAttendance, serviceWeekdayDates: trackedDates };
}

export type MemberBasic = {
  id: string;
  full_name: string;
  phone: string | null;
  assigned_servant_id: string | null;
  group_id: string;
};

/** Lightweight roster fetch for contexts that just need id/name/phone/
 * assignment (e.g. the Outreach tab's member picker) -- skips the
 * per-member average-attendance computation getGroupMembers does, which
 * requires a second full attendance_records fetch this doesn't need. */
export async function getGroupMembersLite(groupId: string | string[]): Promise<MemberBasic[]> {
  const supabase = await createClient();
  // Paged via fetchAllRows -- see getGroupMembers above for why an unpaged
  // `.select()` silently truncates past PostgREST's 1000-row cap.
  return fetchAllRows((from, to) => {
    let q = supabase
      .from("members")
      .select("id, full_name, phone, assigned_servant_id, group_id")
      .eq("status", "active")
      .order("full_name")
      .order("id")
      .range(from, to);
    q = Array.isArray(groupId) ? q.in("group_id", groupId) : q.eq("group_id", groupId);
    return q;
  });
}

export async function getMember(memberId: string): Promise<MemberDetail | null> {
  const [supabase, settings] = await Promise.all([createClient(), getAppSettings()]);
  const withParents = settings.show_parent_contacts;
  const { data } = await supabase
    .from("members")
    .select(
      `${LIST_SELECT}, email, university_id, father_of_confession, home_address, registration_comments, servant_comments${
        withParents ? `, ${PARENT_COLUMNS}` : ""
      }`,
    )
    .eq("id", memberId)
    .maybeSingle();

  if (!data) return null;
  const row = data as unknown as MemberDetail & Partial<ParentContacts>;
  return { ...row, parents: withParents ? pickParents(row) : null, avgAttendancePercent: null };
}
