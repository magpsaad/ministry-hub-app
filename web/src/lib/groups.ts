import { createClient } from "@/lib/supabase/server";
import type { AccessSummary } from "@/lib/roles";
import { ALL_COHORTS_GROUP_ID } from "@/lib/allCohorts";
export { LAST_GROUP_COOKIE } from "@/lib/allCohorts";

export type GroupSummary = {
  id: string;
  name: string;
  ladder_position: number;
  is_terminal: boolean;
};

/**
 * Groups the current user can see, per RLS (REQUIREMENTS.md §2.2, §4.4):
 * Admins see every group including the hidden position-0 pre-entry cohort;
 * everyone else sees only groups they hold a role against. No extra
 * filtering needed here -- the database already enforces this.
 *
 * `is_terminal` used to be a generated column hardcoded to `ladder_position
 * >= 5` -- now that the ladder length is admin-configurable (§6.9, migration
 * 0030), "terminal" just means "whichever position is currently highest
 * among this set of active groups," computed here from the rows already
 * fetched rather than a fixed number.
 */
export async function getAccessibleGroups(): Promise<GroupSummary[]> {
  const supabase = await createClient();
  const { data } = await supabase
    .from("groups")
    .select("id, name, ladder_position")
    .eq("is_archived", false)
    .order("display_order");

  const rows = data ?? [];
  const terminalPosition = rows.length > 0 ? Math.max(...rows.map((g) => g.ladder_position)) : null;
  return rows.map((g) => ({ ...g, is_terminal: g.ladder_position === terminalPosition }));
}

/**
 * The "Load Youth Data for all cohorts" combined view's group set: every
 * serving cohort (ladder_position > 0) this user can see, per RLS -- same
 * `ladder_position > 0` exclusion the landing page's own group selector
 * already applies (the hidden position-0 pre-entry group stays Admin-only,
 * REQUIREMENTS.md §2.2). A General Coordinator gets literally every real
 * cohort; a Sub-Coordinator gets whichever ones they actually hold a role
 * at (RLS-filtered by getAccessibleGroups() itself, no extra filtering
 * needed here) -- so "all cohorts" always means "everything this specific
 * user can see," never a hardcoded ministry-wide list.
 */
export async function getCombinedGroups(): Promise<GroupSummary[]> {
  const groups = await getAccessibleGroups();
  return groups.filter((g) => g.ladder_position > 0);
}

/**
 * "Which cohorts can I load/export real member data for" -- narrower than
 * "which cohorts can I see the name of" (groups_select was widened to
 * is_app_user() in migration 0038, so getAccessibleGroups() alone now
 * returns every cohort to any app user). The actual `members` rows stay
 * RLS-gated to has_readonly_or_full_group_access(group_id), so a
 * Sub-Coordinator picking a cohort they don't hold a role at would just
 * silently get zero rows back -- this computes the narrower, real answer
 * up front instead: every non-Yr0 cohort for an Admin/General Coordinator,
 * or only the specific ones a Sub-Coordinator/Servant/Read-Only actually
 * holds a role at.
 */
export function filterSelectableGroups(groups: GroupSummary[], access: AccessSummary): GroupSummary[] {
  const hasFullGroupAccess = access.isAdmin || access.isGeneralCoordinator;
  const ownGroupIds = new Set(access.roles.map((r) => r.group_id).filter((id): id is string => id !== null));
  return groups.filter((g) => g.ladder_position > 0 && (hasFullGroupAccess || ownGroupIds.has(g.id)));
}

/**
 * SIDE_MENU_PLAN.md D3/D4 -- the cohorts this person actually serves: any
 * role row other than read-only that points at a specific cohort (Servant,
 * Sub-Coordinator, or an Admin/General Coordinator who also serves one).
 * Kept in display order, so the first entry is the "first listed" cohort.
 */
export function getServingGroups(groups: GroupSummary[], access: AccessSummary): GroupSummary[] {
  const servingIds = new Set(
    access.roles.filter((r) => r.role !== "read_only" && r.group_id !== null).map((r) => r.group_id as string),
  );
  return filterSelectableGroups(groups, access).filter((g) => servingIds.has(g.id));
}

export type SwitcherEntry = { id: string; name: string; tag: "serving" | "view only" | "admin" | null };

/**
 * SIDE_MENU_PLAN.md §3.2 (revised) -- the side menu's cohort switcher. Always
 * the same fixed order for everyone: by level (the hidden pre-entry group
 * first, for Admins only, then Yr 1 up through the last), then Combined
 * (Admin/General Coordinator only, same rule as the group layout) at the
 * bottom. Each person only sees the ones they can open. Built only from
 * filterSelectableGroups(), so it never lists a cohort the landing page's
 * old dropdown wouldn't have.
 */
export function buildSwitcherEntries(
  groups: GroupSummary[],
  access: AccessSummary,
  combinedName: string,
): SwitcherEntry[] {
  const hasFullGroupAccess = access.isAdmin || access.isGeneralCoordinator;
  const servingIds = new Set(getServingGroups(groups, access).map((g) => g.id));
  const preEntry = access.isAdmin ? groups.filter((g) => g.ladder_position === 0) : [];
  const ordered = [...preEntry, ...filterSelectableGroups(groups, access)].sort(
    (a, b) => a.ladder_position - b.ladder_position,
  );

  const entries: SwitcherEntry[] = ordered.map((g) => ({
    id: g.id,
    name: g.name,
    tag: g.ladder_position === 0 ? "admin" : servingIds.has(g.id) ? "serving" : hasFullGroupAccess ? null : "view only",
  }));
  if (hasFullGroupAccess) entries.push({ id: ALL_COHORTS_GROUP_ID, name: combinedName, tag: null });
  return entries;
}

/**
 * SIDE_MENU_PLAN.md §3.1 -- a person's default cohort: where `/` lands them
 * and what the side menu's cohort row shows. The cohort they serve (the
 * last one opened from the switcher if they serve several and it's still
 * theirs, otherwise the first listed); else Combined for an Admin/General
 * Coordinator; else (owner-requested) the first cohort they have read-only
 * access to, in the switcher's fixed order; else none -- only someone with
 * no cohort they can open at all. Worked out from the current roles every
 * time.
 */
export function pickDefaultGroupId(
  groups: GroupSummary[],
  access: AccessSummary,
  lastOpenedId: string | undefined,
): string | null {
  const serving = getServingGroups(groups, access);
  if (serving.length > 0) return (serving.find((g) => g.id === lastOpenedId) ?? serving[0]).id;
  if (access.isAdmin || access.isGeneralCoordinator) return ALL_COHORTS_GROUP_ID;
  const viewOnly = filterSelectableGroups(groups, access).sort((a, b) => a.ladder_position - b.ladder_position);
  return viewOnly[0]?.id ?? null;
}
