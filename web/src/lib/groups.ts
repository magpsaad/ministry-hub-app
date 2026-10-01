import { createClient } from "@/lib/supabase/server";
import { getAccessSummary, type AccessSummary } from "@/lib/roles";
import { getCurrentUser } from "@/lib/supabase/get-current-user";
import { ALL_COHORTS_GROUP_ID } from "@/lib/allCohorts";
export { LAST_GROUP_COOKIE } from "@/lib/allCohorts";

/** GROUP_LADDER_PLAN.md §3.1 -- pre_entry (hidden intake group, level 0),
 * regular (levels 1..N, several may share a level) and terminal (the hidden
 * hand-over group). */
export type GroupKind = "pre_entry" | "regular" | "terminal";

export type GroupSummary = {
  id: string;
  name: string;
  /** The level (Yr 3, Grade 10 before the ministry's number offset). */
  ladder_position: number;
  /** Where the group appears in lists and the cohort switcher (D4). */
  display_order: number;
  kind: GroupKind;
  is_terminal: boolean;
};

/**
 * Groups the current user can see, per RLS, in display order (D4): Admins
 * see every group including the hidden pre-entry and hand-over groups; the
 * database hides those two from everyone else (migration 0069), so no extra
 * filtering is needed here.
 */
export async function getAccessibleGroups(): Promise<GroupSummary[]> {
  const supabase = await createClient();
  const { data } = await supabase
    .from("groups")
    .select("id, name, ladder_position, display_order, kind")
    .eq("is_archived", false)
    .order("display_order");

  return (data ?? []).map((g) => ({ ...(g as Omit<GroupSummary, "is_terminal">), is_terminal: g.kind === "terminal" }));
}

/** GROUP_LADDER_PLAN.md D14/§4.6 -- the regular groups where this person is
 * a Coordinator, in display order. Two or more of them give a non-Admin,
 * non-General-Coordinator their own combined view of just those groups. */
export function coordinatorScope(groups: GroupSummary[], access: AccessSummary): GroupSummary[] {
  const coordinated = new Set(
    access.roles.filter((r) => r.role === "sub_coordinator" && r.group_id !== null).map((r) => r.group_id as string),
  );
  return groups.filter((g) => g.kind === "regular" && coordinated.has(g.id));
}

/** Whether this person gets the coordinator's combined view (D14) rather
 * than the Admin/General Coordinator "all groups" one. */
export function hasCoordinatorCombined(groups: GroupSummary[], access: AccessSummary): boolean {
  return !access.isAdmin && !access.isGeneralCoordinator && coordinatorScope(groups, access).length >= 2;
}

/** The coordinator's combined view's name (§4.6): the leading words the
 * group names share, without a dangling "St"/"St." ("Gr10 Boys St Anthony"
 * + "Gr10 Boys St Moses" -> "Gr10 Boys"); when they share none, the levels
 * joined ("2004 - Yr 5" + "2003 - Yr 6" -> "Yr 5 + Yr 6"). */
export function coordinatorCombinedName(
  scope: GroupSummary[],
  levelWord: string,
  levelOffset: number,
): string {
  if (scope.length < 2) return "";
  const words = scope.map((g) => g.name.trim().split(/\s+/));
  const shared: string[] = [];
  const longest = Math.min(...words.map((w) => w.length - 1));
  for (let i = 0; i < longest && words.every((w) => w[i] === words[0][i]); i++) shared.push(words[0][i]);
  while (shared.length > 0 && /^(st\.?|-|–)$/i.test(shared[shared.length - 1])) shared.pop();
  if (shared.length > 0) return shared.join(" ");
  const levels = [...new Set(scope.map((g) => g.ladder_position))].sort((a, b) => a - b);
  return levels.map((l) => `${levelWord} ${l + levelOffset}`.trim()).join(" + ");
}

/**
 * The groups the combined ("all cohorts") pages cover for this person:
 * every regular group for an Admin or General Coordinator; for a
 * Coordinator of two or more groups (D14), just those groups. The hidden
 * pre-entry and hand-over groups are never part of it.
 */
export async function getCombinedGroups(): Promise<GroupSummary[]> {
  const [groups, user] = await Promise.all([getAccessibleGroups(), getCurrentUser()]);
  if (!user) return [];
  const regular = groups.filter((g) => g.kind === "regular");
  const access = await getAccessSummary(user.id);
  if (access.isAdmin || access.isGeneralCoordinator) return regular;
  return coordinatorScope(regular, access);
}

/**
 * "Which cohorts can I load/export real member data for" -- narrower than
 * "which cohorts can I see the name of" (groups_select shows every regular
 * group to any app user). Regular groups only: every one for an
 * Admin/General Coordinator, or only the ones a Coordinator/Servant/
 * Read-Only actually holds a role at.
 */
export function filterSelectableGroups(groups: GroupSummary[], access: AccessSummary): GroupSummary[] {
  const hasFullGroupAccess = access.isAdmin || access.isGeneralCoordinator;
  const ownGroupIds = new Set(access.roles.map((r) => r.group_id).filter((id): id is string => id !== null));
  return groups.filter((g) => g.kind === "regular" && (hasFullGroupAccess || ownGroupIds.has(g.id)));
}

/**
 * SIDE_MENU_PLAN.md D3/D4 -- the cohorts this person actually serves: any
 * role row other than read-only that points at a specific cohort (Servant,
 * Coordinator, or an Admin/General Coordinator who also serves one).
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
 * The side menu's cohort switcher, in display order (GROUP_LADDER_PLAN.md
 * §4.5): for Admins the hidden pre-entry group first and the hidden
 * hand-over group(s) last, both tagged "admin" (Q5); the regular groups in
 * between, each person seeing only the ones they can open; then Combined
 * for an Admin/General Coordinator. A Coordinator of two or more groups gets
 * their own combined view at the top (D14).
 */
export function buildSwitcherEntries(
  groups: GroupSummary[],
  access: AccessSummary,
  combinedName: string,
  coordinatorCombined?: string,
): SwitcherEntry[] {
  const hasFullGroupAccess = access.isAdmin || access.isGeneralCoordinator;
  const servingIds = new Set(getServingGroups(groups, access).map((g) => g.id));
  const hidden = (kind: GroupKind) => (access.isAdmin ? groups.filter((g) => g.kind === kind) : []);

  const entries: SwitcherEntry[] = [];
  if (coordinatorCombined && hasCoordinatorCombined(groups, access)) {
    entries.push({ id: ALL_COHORTS_GROUP_ID, name: coordinatorCombined, tag: null });
  }
  for (const g of hidden("pre_entry")) entries.push({ id: g.id, name: g.name, tag: "admin" });
  for (const g of filterSelectableGroups(groups, access)) {
    entries.push({
      id: g.id,
      name: g.name,
      tag: servingIds.has(g.id) ? "serving" : hasFullGroupAccess ? null : "view only",
    });
  }
  for (const g of hidden("terminal")) entries.push({ id: g.id, name: g.name, tag: "admin" });
  if (hasFullGroupAccess) entries.push({ id: ALL_COHORTS_GROUP_ID, name: combinedName, tag: null });
  return entries;
}

/**
 * SIDE_MENU_PLAN.md §3.1 -- a person's default cohort: where `/` lands them
 * and what the side menu's cohort row shows. A Coordinator of two or more
 * groups lands on their combined view (D14) unless they last opened one of
 * their own groups. Otherwise: the cohort they serve (the last one opened
 * if they serve several and it's still theirs, otherwise the first listed);
 * else Combined for an Admin/General Coordinator; else the first cohort they
 * have read-only access to; else none. A hidden group is never anyone's
 * default. Worked out from the current roles every time.
 */
export function pickDefaultGroupId(
  groups: GroupSummary[],
  access: AccessSummary,
  lastOpenedId: string | undefined,
): string | null {
  const serving = getServingGroups(groups, access);
  if (hasCoordinatorCombined(groups, access)) {
    return serving.find((g) => g.id === lastOpenedId)?.id ?? ALL_COHORTS_GROUP_ID;
  }
  if (serving.length > 0) return (serving.find((g) => g.id === lastOpenedId) ?? serving[0]).id;
  if (access.isAdmin || access.isGeneralCoordinator) return ALL_COHORTS_GROUP_ID;
  return filterSelectableGroups(groups, access)[0]?.id ?? null;
}
