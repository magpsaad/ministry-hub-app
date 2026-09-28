import { createClient } from "@/lib/supabase/server";
import { fetchAllRows } from "@/lib/pagination";

export type ServantGroup = { id: string; name: string; ladder_position: number };

export type ServantOption = {
  id: string;
  full_name: string;
  gender: string | null;
  caseload: number;
  /** Which cohort(s) this person holds a 'servant' grant for -- always
   * populated (even for a single-group call, where it's just that one
   * group's own info), but only meaningfully shown/grouped-by once
   * servants from several cohorts are listed together (the "all cohorts"
   * combined view's Analytics table, REQUIREMENTS.md §6.7 addendum -- a
   * person holding Servant grants at more than one cohort has more than
   * one entry here). Carries ladder_position (not just the name) so a
   * categorical grouping can order cohorts youngest-to-oldest rather than
   * alphabetically -- same fix already applied to Servant Assignments/
   * Servant Profiles' own categorical views. */
  groups: ServantGroup[];
};

/**
 * Servants who hold the `servant` role for this group (or, when `groupId`
 * is an array, for any of several groups at once -- the "all cohorts"
 * combined view, REQUIREMENTS.md §6.1 addendum) -- i.e. who should appear
 * in that group's assignment dropdown (REQUIREMENTS.md §4.1). Caseload =
 * how many active members already assigned to them, across whichever
 * group(s) were asked for, shown so coordinators can balance assignments
 * (matches the current app's "(has N)" annotation).
 */
export async function getServantsForGroup(groupId: string | string[]): Promise<ServantOption[]> {
  const supabase = await createClient();

  let roleQuery = supabase
    .from("user_roles")
    .select("user_id, group_id, profiles(id, full_name, gender), groups(name, ladder_position)")
    .eq("role", "servant");
  roleQuery = Array.isArray(groupId) ? roleQuery.in("group_id", groupId) : roleQuery.eq("group_id", groupId);

  // The caseload count doesn't depend on the role rows (it filters by group,
  // not by servant), so both are fetched in parallel. Paged: the combined
  // "all cohorts" view can pass PostgREST's 1000-row cap.
  const [{ data: roleRows }, members] = await Promise.all([
    roleQuery,
    fetchAllRows((from, to) => {
      let q = supabase
        .from("members")
        .select("assigned_servant_id")
        .eq("status", "active")
        .not("assigned_servant_id", "is", null)
        .order("id")
        .range(from, to);
      q = Array.isArray(groupId) ? q.in("group_id", groupId) : q.eq("group_id", groupId);
      return q;
    }),
  ]);

  const byId = new Map<string, { id: string; full_name: string; gender: string | null; groups: ServantGroup[] }>();
  for (const r of roleRows ?? []) {
    const p = r.profiles as unknown as { id: string; full_name: string; gender: string | null } | null;
    if (!p) continue;
    const group = r.groups as unknown as { name: string; ladder_position: number } | null;
    const existing = byId.get(p.id);
    if (existing) {
      if (group && r.group_id && !existing.groups.some((g) => g.id === r.group_id)) {
        existing.groups.push({ id: r.group_id, name: group.name, ladder_position: group.ladder_position });
      }
    } else {
      byId.set(p.id, {
        id: p.id,
        full_name: p.full_name,
        gender: p.gender,
        groups: group && r.group_id ? [{ id: r.group_id, name: group.name, ladder_position: group.ladder_position }] : [],
      });
    }
  }
  const servants = Array.from(byId.values());
  if (servants.length === 0) return [];

  const caseloadByServant = new Map<string, number>();
  for (const m of members) {
    if (!m.assigned_servant_id) continue;
    caseloadByServant.set(m.assigned_servant_id, (caseloadByServant.get(m.assigned_servant_id) ?? 0) + 1);
  }

  return servants
    .map((s) => ({ ...s, caseload: caseloadByServant.get(s.id) ?? 0 }))
    .sort((a, b) => a.full_name.localeCompare(b.full_name));
}
