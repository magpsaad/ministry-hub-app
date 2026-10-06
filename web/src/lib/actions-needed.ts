import { cache } from "react";
import { createClient } from "@/lib/supabase/server";
import { fetchAllRows } from "@/lib/pagination";
import { getAppSettings } from "@/lib/app-settings";
import { shiftDateKey, todayInZone } from "@/lib/timezone";

export type ActionsNeededMember = {
  id: string;
  full_name: string;
  photo_path: string | null;
  phone: string | null;
  assigned_servant_id: string | null;
  assignedServantName: string | null;
  proximity: "Local" | "Regional" | "Abroad" | "Unknown";
  presenceCount: number;
  currentConsecutiveAbsences: number;
  lastOutreachDate: string | null;
  group_id: string;
};

type ConfigRow = { proximity: string; min_presence_count: number; min_absence_weeks: number; min_outreach_weeks: number };

/** For the Dashboard's "?" help text -- generated from these same live
 * values (REQUIREMENTS.md §6.9), never hardcoded, so an Admin editing a
 * threshold on the config screen immediately updates what's explained here.
 * React.cache()-memoized per request: the Dashboard page and
 * getActionsNeeded() below share one query. */
export const getActionsNeededConfig = cache(async (): Promise<ConfigRow[]> => {
  const supabase = await createClient();
  const { data } = await supabase
    .from("actions_needed_config")
    .select("proximity, min_presence_count, min_absence_weeks, min_outreach_weeks")
    .order("proximity");
  return data ?? [];
});

/**
 * REQUIREMENTS.md §7.1 -- for each active, non-visitor member: presence_count
 * (trailing ctions_needed_lookback_months, 12 by default), current_consecutive_absences (owner-defined formula:
 * floor((today - last_present_date) / 7), all-time, not windowed), and
 * whether their outreach is stale (never, or older than that proximity's
 * min_outreach_weeks). Flagged iff all three thresholds hold at once, per
 * the member's proximity-based config.
 */
export async function getActionsNeeded(groupId: string): Promise<ActionsNeededMember[]> {
  const supabase = await createClient();

  const [{ data: members }, config, appSettings] = await Promise.all([
    supabase
      .from("members")
      .select(
        "id, full_name, photo_path, phone, is_visitor, assigned_servant_id, created_at, assigned_servant:profiles(full_name), university:universities(proximity)",
      )
      .eq("group_id", groupId)
      .eq("status", "active"),
    getActionsNeededConfig(),
    getAppSettings(),
  ]);

  const activeNonVisitors = ((members ?? []) as unknown as ActionsNeededInputMember[]).filter((m) => !m.is_visitor);
  if (activeNonVisitors.length === 0) return [];
  const memberIds = activeNonVisitors.map((m) => m.id);

  // One all-time attendance read (paged -- a cohort easily exceeds
  // PostgREST's 1000-row cap, lib/pagination.ts) and one outreach read, run
  // in parallel. The look-back presence count is derived from the same
  // all-time rows (it used to be a second, separately paged query), and the
  // outreach read is now paged too (it was silently capped at 1000 rows).
  //
  // "Weeks absent" is plain calendar math from the member's TRUE all-time
  // last-present date (owner-reported: counting tracked service occurrences
  // diverged badly from real elapsed time), which is why the all-time rows
  // are needed at all.
  const [allPresentRows, outreachRows] = await Promise.all([
    fetchAllRows((from, to) =>
      supabase
        .from("attendance_records")
        .select("member_id, service_date")
        .eq("attendee_type", "member")
        .in("member_id", memberIds)
        .order("service_date", { ascending: false })
        .order("id")
        .range(from, to),
    ),
    fetchAllRows((from, to) =>
      supabase
        .from("outreach_entries")
        .select("member_id, occurred_at")
        .in("member_id", memberIds)
        .order("occurred_at", { ascending: false })
        .order("id")
        .range(from, to),
    ),
  ]);

  return computeActionsNeeded(
    activeNonVisitors.map((m) => ({ ...m, group_id: groupId })),
    allPresentRows,
    outreachRows,
    config,
    appSettings.proximity_enabled,
    appSettings.actions_needed_lookback_months,
    appSettings.timezone,
  );
}

/** A youth as computeActionsNeeded() needs them (the select above). */
export type ActionsNeededInputMember = {
  id: string;
  full_name: string;
  photo_path: string | null;
  phone: string | null;
  is_visitor: boolean | null;
  assigned_servant_id: string | null;
  created_at: string | null;
  assigned_servant: { full_name: string } | null;
  university: { proximity?: string } | null;
  group_id: string;
};

/** The Actions Needed rule itself, from rows already read: active non-visitor
 * youths, their attendance (newest first) and outreach (newest first).
 * Shared by the single-group Dashboard and the combined one, which reads
 * every group's rows at once. */
export function computeActionsNeeded(
  activeNonVisitors: ActionsNeededInputMember[],
  allPresentRows: { member_id: string | null; service_date: string }[],
  outreachRows: { member_id: string; occurred_at: string }[],
  config: ConfigRow[],
  proximityEnabled: boolean,
  lookbackMonths: number,
  timeZone: string,
): ActionsNeededMember[] {
  const configByProximity = new Map(config.map((c: ConfigRow) => [c.proximity, c]));

  // Look-back for presenceCount: App Settings' actions_needed_lookback_months
  // (was a fixed 12 months -- MULTI_TENANT_PLAN.md §10, A12).
  // From the ministry's calendar day, not the server's UTC one.
  const cutoffISO = shiftDateKey(todayInZone(timeZone), { months: -lookbackMonths });

  const presentByMember = new Map<string, Set<string>>();
  const lastPresentByMember = new Map<string, string>();
  for (const row of allPresentRows) {
    if (!row.member_id) continue;
    if (!lastPresentByMember.has(row.member_id)) lastPresentByMember.set(row.member_id, row.service_date);
    if (row.service_date >= cutoffISO) {
      if (!presentByMember.has(row.member_id)) presentByMember.set(row.member_id, new Set());
      presentByMember.get(row.member_id)!.add(row.service_date);
    }
  }
  const latestOutreachByMember = new Map<string, string>();
  for (const row of outreachRows) {
    if (!latestOutreachByMember.has(row.member_id)) latestOutreachByMember.set(row.member_id, row.occurred_at);
  }

  const now = Date.now();
  const results: ActionsNeededMember[] = [];

  for (const m of activeNonVisitors) {
    // Proximity turned off in App Settings: everyone is Local, judged by the
    // Local thresholds alone, whatever their school happens to be tagged.
    const proximity = (proximityEnabled ? (m.university?.proximity ?? "Unknown") : "Local") as ActionsNeededMember["proximity"];
    const cfg = configByProximity.get(proximity);
    if (!cfg) continue;

    const memberDates = presentByMember.get(m.id) ?? new Set<string>();
    const presenceCount = memberDates.size;

    // Reference point for "weeks absent": their true last-present date, or
    // (for someone with NO presence on record at all -- a real, reachable
    // case since Abroad's min_presence_count config is 0) the date they
    // joined, so a never-attended member still gets a meaningful "weeks
    // absent" instead of an arbitrary/undefined one.
    const referenceDate = lastPresentByMember.get(m.id) ?? m.created_at?.slice(0, 10) ?? null;
    const currentConsecutiveAbsences = referenceDate
      ? Math.floor((now - new Date(`${referenceDate}T00:00:00Z`).getTime()) / (7 * 86400000))
      : 0;

    const lastOutreach = latestOutreachByMember.get(m.id) ?? null;
    const outreachIsStale =
      !lastOutreach || now - new Date(lastOutreach).getTime() > cfg.min_outreach_weeks * 7 * 86400000;

    if (
      presenceCount >= cfg.min_presence_count &&
      currentConsecutiveAbsences >= cfg.min_absence_weeks &&
      outreachIsStale
    ) {
      results.push({
        id: m.id,
        full_name: m.full_name,
        photo_path: m.photo_path,
        phone: m.phone,
        assigned_servant_id: m.assigned_servant_id,
        assignedServantName: m.assigned_servant?.full_name ?? null,
        proximity,
        presenceCount,
        currentConsecutiveAbsences,
        lastOutreachDate: lastOutreach,
        group_id: m.group_id,
      });
    }
  }

  return results;
}
