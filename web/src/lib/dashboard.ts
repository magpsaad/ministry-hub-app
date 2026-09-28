import { cache } from "react";
import { createClient } from "@/lib/supabase/server";
import { getAppSettings } from "@/lib/app-settings";
import { fetchAllRows } from "@/lib/pagination";

export type MemberStatRow = {
  id: string;
  assigned_servant_id: string | null;
  everAttended: boolean;
  presentLastService: boolean;
};

export type DashboardStatsData = {
  rows: MemberStatRow[];
  lastServiceDate: string | null;
  visitorCount: number;
};

export type BirthdayMember = {
  id: string;
  full_name: string;
  photo_path: string | null;
  date_of_birth: string;
  phone: string | null;
  assigned_servant_id: string | null;
  assigned_servant: { full_name: string } | null;
};

export type UnassignedMember = {
  id: string;
  full_name: string;
  photo_path: string | null;
  phone: string | null;
  program_of_study: string | null;
  university: { name: string } | null;
  gender: string | null;
  /** YYYY-MM-DD: the member's join date (first attendance), or -- for someone
   * who registered but hasn't attended yet, so has no join date -- the day
   * they registered, in the app's timezone. */
  joinedOn: string | null;
};

/** REQUIREMENTS.md §6.3/§7.1 -- members recently assigned a servant who
 * haven't been outreached yet (`is_new_assignment`, cleared automatically
 * once an outreach entry is recorded for them -- migration 0029's trigger --
 * or when a servant dismisses the card). Surfaced under the assigned
 * servant's own list in the Dashboard's Actions Needed section. */
export type NewlyAssignedMember = {
  id: string;
  full_name: string;
  photo_path: string | null;
  phone: string | null;
  program_of_study: string | null;
  university: { name: string } | null;
  gender: string | null;
  assigned_servant_id: string;
  assignedServantName: string;
};

/** Lightweight, used by the nav shell header on every tab (not just Dashboard).
 * React.cache()-memoized per request: the group layout and the Dashboard's
 * stats (one call per cohort on the combined view) share one query. */
export const getLastServiceDate = cache(async (): Promise<string | null> => {
  const supabase = await createClient();
  const { data } = await supabase
    .from("attendance_records")
    .select("service_date")
    .eq("attendee_type", "member")
    .order("service_date", { ascending: false })
    .limit(1)
    .maybeSingle();
  return data?.service_date ?? null;
});

/**
 * REQUIREMENTS.md §6.3/§7.2/§6.2. Returns per-member raw rows rather than
 * pre-aggregated counts, so the Dashboard's client-side "My Assigned List"
 * toggle can recompute Overview from the same fetch instead of round-
 * tripping to the server -- same client-side-filter architecture as the
 * Member List. (Proximity moved to Analytics-only, §8.1 -- no longer
 * computed or joined here.) "Tracked" service dates are whichever dates
 * actually have
 * at least one attendance row -- there are none yet, since the Attendance tab
 * (Phase C) hasn't been built, so `lastServiceDate` correctly comes back null
 * rather than a misleading 0 for present/absent counts.
 */
export async function getDashboardStatsData(groupId: string): Promise<DashboardStatsData> {
  const supabase = await createClient();

  // Members and the latest service date don't depend on each other -- fetched
  // together (they used to be two sequential round trips).
  const [{ data: members }, latestServiceDate] = await Promise.all([
    supabase.from("members").select("id, is_visitor, assigned_servant_id").eq("group_id", groupId).eq("status", "active"),
    getLastServiceDate(),
  ]);

  const active = members ?? [];
  const nonVisitors = active.filter((m) => !m.is_visitor);
  const memberIds = nonVisitors.map((m) => m.id);

  let lastServiceDate: string | null = null;
  let everAttendedSet = new Set<string>();
  let presentLastServiceSet = new Set<string>();

  if (memberIds.length > 0) {
    if (latestServiceDate) {
      lastServiceDate = latestServiceDate;

      // All-time, per-cohort -- can exceed one page on its own (confirmed
      // directly: Yr1 alone already has 1200+ attendance_records), so a
      // plain single request here would silently truncate and mark some
      // members "Never Attended" who actually have (whichever ones happen
      // to fall past row 1000). Paged via fetchAllRows (lib/pagination.ts).
      // The two attendance reads are independent -- fetched in parallel.
      const [attendedIds, { data: presentRows }] = await Promise.all([
        fetchAllRows((from, to) =>
          supabase
            .from("attendance_records")
            .select("member_id")
            .eq("attendee_type", "member")
            .in("member_id", memberIds)
            .range(from, to),
        ),
        supabase
          .from("attendance_records")
          .select("member_id")
          .eq("attendee_type", "member")
          .eq("service_date", latestServiceDate)
          .in("member_id", memberIds),
      ]);
      everAttendedSet = new Set(attendedIds.map((r) => r.member_id));
      presentLastServiceSet = new Set((presentRows ?? []).map((r) => r.member_id));
    }
  }

  const rows: MemberStatRow[] = nonVisitors.map((m) => ({
    id: m.id,
    assigned_servant_id: m.assigned_servant_id,
    everAttended: everAttendedSet.has(m.id),
    presentLastService: presentLastServiceSet.has(m.id),
  }));

  return { rows, lastServiceDate, visitorCount: active.length - nonVisitors.length };
}

/** REQUIREMENTS.md §6.3 -- admin-configurable days-before/days-after window
 * (default 7/14), wrapping the year boundary. Date-of-birth is an ISO
 * date-only string ("YYYY-MM-DD"); `new Date(iso)` parses that as UTC
 * midnight, so calling local getters on it shifts the date back a day in
 * any timezone behind UTC -- parse the y/m/d components by hand instead
 * (same fix already applied elsewhere, e.g. AttendanceInteractive's
 * formatDate) rather than going through the UTC-anchored Date. */
export async function getUpcomingBirthdays(groupId: string): Promise<BirthdayMember[]> {
  const supabase = await createClient();
  const [{ data }, settings] = await Promise.all([
    supabase
      .from("members")
      .select("id, full_name, photo_path, date_of_birth, phone, assigned_servant_id, assigned_servant:profiles(full_name)")
      .eq("group_id", groupId)
      .eq("status", "active")
      .not("date_of_birth", "is", null),
    getAppSettings(),
  ]);

  const daysBefore = settings.birthday_window_days_before;
  const daysAfter = settings.birthday_window_days_after;

  const today = new Date();
  today.setHours(0, 0, 0, 0);
  const dayOfYear = (d: Date) => {
    const start = new Date(d.getFullYear(), 0, 0);
    return Math.floor((d.getTime() - start.getTime()) / 86400000);
  };
  const todayDoy = dayOfYear(today);

  // Owner-reported: these weren't sorted in any meaningful order (whatever
  // order the query happened to return). Sorted by that same signed diff --
  // most-recently-passed first, through today, to soonest-upcoming last --
  // computed once per member and kept alongside it rather than recomputed
  // twice.
  return ((data ?? []) as unknown as BirthdayMember[])
    .map((m) => {
      const [, month, day] = m.date_of_birth.split("-").map(Number);
      const bdayThisYear = new Date(today.getFullYear(), month - 1, day);
      let diff = dayOfYear(bdayThisYear) - todayDoy;
      // wrap around the year boundary in both directions
      if (diff < -daysBefore) diff += 365;
      if (diff > daysAfter) diff -= 365;
      return { member: m, diff };
    })
    .filter(({ diff }) => diff >= -daysBefore && diff <= daysAfter)
    .sort((a, b) => a.diff - b.diff)
    .map(({ member }) => member);
}

/** REQUIREMENTS.md §6.3 -- members with no assigned servant yet. */
export async function getUnassignedMembers(groupId: string): Promise<UnassignedMember[]> {
  const supabase = await createClient();
  const [{ data }, settings] = await Promise.all([
    supabase
      .from("members")
      .select("id, full_name, photo_path, phone, program_of_study, gender, join_date, created_at, university:universities(name)")
      .eq("group_id", groupId)
      .eq("status", "active")
      .is("assigned_servant_id", null)
      .order("created_at", { ascending: false }),
    getAppSettings(),
  ]);

  const registeredOn = new Intl.DateTimeFormat("en-CA", {
    timeZone: settings.timezone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  });

  return ((data ?? []) as unknown as (Omit<UnassignedMember, "joinedOn"> & {
    join_date: string | null;
    created_at: string | null;
  })[]).map(({ join_date, created_at, ...m }) => ({
    ...m,
    joinedOn: join_date ?? (created_at ? registeredOn.format(new Date(created_at)) : null),
  }));
}

/** REQUIREMENTS.md §6.3/§7.1 -- members with `is_new_assignment = true`,
 * i.e. assigned a servant recently enough that no outreach entry has been
 * recorded for them yet (set by assignServantAction, auto-cleared by
 * migration 0029's trigger the moment an outreach entry lands, or manually
 * dismissed). Grouped by assigned servant on the Dashboard. */
export async function getNewlyAssignedMembers(groupId: string): Promise<NewlyAssignedMember[]> {
  const supabase = await createClient();
  const { data } = await supabase
    .from("members")
    .select(
      "id, full_name, photo_path, phone, program_of_study, gender, assigned_servant_id, university:universities(name), assigned_servant:profiles(full_name)",
    )
    .eq("group_id", groupId)
    .eq("status", "active")
    .eq("is_new_assignment", true)
    .not("assigned_servant_id", "is", null)
    .order("created_at", { ascending: false });

  return ((data ?? []) as unknown as {
    id: string;
    full_name: string;
    photo_path: string | null;
    phone: string | null;
    program_of_study: string | null;
    gender: string | null;
    assigned_servant_id: string;
    university: { name: string } | null;
    assigned_servant: { full_name: string } | null;
  }[]).map((m) => ({
    id: m.id,
    full_name: m.full_name,
    photo_path: m.photo_path,
    phone: m.phone,
    program_of_study: m.program_of_study,
    gender: m.gender,
    university: m.university,
    assigned_servant_id: m.assigned_servant_id,
    assignedServantName: m.assigned_servant?.full_name ?? "Unknown",
  }));
}
