import { createClient } from "@/lib/supabase/server";
import { getAppSettings } from "@/lib/app-settings";
import { fetchAllRows } from "@/lib/pagination";
import {
  birthdaysInWindow,
  getLastServiceDate,
  withJoinedOn,
  type BirthdayMember,
  type DashboardStatsData,
  type NewlyAssignedMember,
  type UnassignedMember,
} from "@/lib/dashboard";
import {
  computeActionsNeeded,
  getActionsNeededConfig,
  type ActionsNeededInputMember,
  type ActionsNeededMember,
} from "@/lib/actions-needed";
import { getFollowUpsDue, type FollowUpDueEntry } from "@/lib/outreach";

export type CombinedDashboardData = {
  statsData: DashboardStatsData;
  birthdays: BirthdayMember[];
  unassigned: UnassignedMember[];
  actionsNeeded: ActionsNeededMember[];
  newlyAssigned: NewlyAssignedMember[];
  followUpsDue: FollowUpDueEntry[];
};

type MemberRow = ActionsNeededInputMember & {
  date_of_birth: string | null;
  program_of_study: string | null;
  gender: string | null;
  join_date: string | null;
  is_new_assignment: boolean | null;
};

/**
 * Owner-requested speed-up (30 Sep 2026): every section of the combined
 * Dashboard from a handful of reads over ALL the view's groups at once --
 * youths, all-time attendance and outreach (filtered by the youth's group
 * through a join, so no long list of ids goes into a request), and the
 * follow-ups due -- instead of about six reads per group. The rules are the
 * single-group Dashboard's own (birthdaysInWindow, withJoinedOn,
 * computeActionsNeeded), so both always agree.
 */
export async function getCombinedDashboardData(groupIds: string[]): Promise<CombinedDashboardData> {
  if (groupIds.length === 0) {
    return {
      statsData: { rows: [], lastServiceDate: null, visitorCount: 0 },
      birthdays: [],
      unassigned: [],
      actionsNeeded: [],
      newlyAssigned: [],
      followUpsDue: [],
    };
  }
  const supabase = await createClient();

  const [settings, config, lastServiceDate, members, attendance, outreach, followUpsDue] = await Promise.all([
    getAppSettings(),
    getActionsNeededConfig(),
    getLastServiceDate(),
    fetchAllRows((from, to) =>
      supabase
        .from("members")
        .select(
          "id, group_id, full_name, photo_path, phone, is_visitor, assigned_servant_id, is_new_assignment, created_at, join_date, date_of_birth, program_of_study, gender, assigned_servant:profiles(full_name), university:universities(name, proximity)",
        )
        .in("group_id", groupIds)
        .eq("status", "active")
        .order("created_at", { ascending: false })
        .order("id")
        .range(from, to),
    ) as Promise<unknown[]> as Promise<(MemberRow & { university: { name: string; proximity?: string } | null })[]>,
    fetchAllRows((from, to) =>
      supabase
        .from("attendance_records")
        .select("member_id, service_date, member:members!inner(group_id, status)")
        .eq("attendee_type", "member")
        .in("member.group_id", groupIds)
        .eq("member.status", "active")
        .order("service_date", { ascending: false })
        .order("id")
        .range(from, to),
    ) as Promise<unknown[]> as Promise<{ member_id: string | null; service_date: string }[]>,
    fetchAllRows((from, to) =>
      supabase
        .from("outreach_entries")
        .select("member_id, occurred_at, member:members!inner(group_id, status)")
        .in("member.group_id", groupIds)
        .eq("member.status", "active")
        .order("occurred_at", { ascending: false })
        .order("id")
        .range(from, to),
    ) as Promise<unknown[]> as Promise<{ member_id: string; occurred_at: string }[]>,
    getFollowUpsDue(groupIds),
  ]);

  // Overview: same rule as getDashboardStatsData, over every group.
  const nonVisitors = members.filter((m) => !m.is_visitor);
  const everAttended = new Set(attendance.map((r) => r.member_id));
  const presentLast = new Set(
    lastServiceDate ? attendance.filter((r) => r.service_date === lastServiceDate).map((r) => r.member_id) : [],
  );
  const statsData: DashboardStatsData = {
    rows: nonVisitors.map((m) => ({
      id: m.id,
      group_id: m.group_id,
      assigned_servant_id: m.assigned_servant_id,
      everAttended: everAttended.has(m.id),
      presentLastService: presentLast.has(m.id),
    })),
    lastServiceDate: nonVisitors.length > 0 ? lastServiceDate : null,
    visitorCount: members.length - nonVisitors.length,
  };

  const birthdays = birthdaysInWindow(
    members
      .filter((m): m is typeof m & { date_of_birth: string } => !!m.date_of_birth)
      .map((m) => ({
        id: m.id,
        full_name: m.full_name,
        photo_path: m.photo_path,
        date_of_birth: m.date_of_birth,
        phone: m.phone,
        assigned_servant_id: m.assigned_servant_id,
        assigned_servant: m.assigned_servant,
        group_id: m.group_id,
      })),
    settings.birthday_window_days_before,
    settings.birthday_window_days_after,
    settings.timezone,
  );

  // Members are read newest first, the order both of these lists use.
  const unassigned = withJoinedOn(
    members
      .filter((m) => !m.assigned_servant_id)
      .map((m) => ({
        id: m.id,
        full_name: m.full_name,
        photo_path: m.photo_path,
        phone: m.phone,
        program_of_study: m.program_of_study,
        university: m.university ? { name: m.university.name } : null,
        gender: m.gender,
        group_id: m.group_id,
        join_date: m.join_date,
        created_at: m.created_at,
      })),
    settings.timezone,
  );
  const newlyAssigned: NewlyAssignedMember[] = members
    .filter((m) => m.is_new_assignment && m.assigned_servant_id)
    .map((m) => ({
      id: m.id,
      full_name: m.full_name,
      photo_path: m.photo_path,
      phone: m.phone,
      program_of_study: m.program_of_study,
      gender: m.gender,
      university: m.university ? { name: m.university.name } : null,
      assigned_servant_id: m.assigned_servant_id as string,
      assignedServantName: m.assigned_servant?.full_name ?? "Unknown",
      group_id: m.group_id,
    }));

  const actionsNeeded = computeActionsNeeded(
    nonVisitors,
    attendance,
    outreach,
    config,
    settings.proximity_enabled,
    settings.actions_needed_lookback_months,
    settings.timezone,
  );

  return { statsData, birthdays, unassigned, actionsNeeded, newlyAssigned, followUpsDue };
}
