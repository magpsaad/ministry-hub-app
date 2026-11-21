"use server";

import { createClient } from "@/lib/supabase/server";
import { fetchAllRows } from "@/lib/pagination";

/** Owner-requested: names only, nothing else from the profile/member record
 * -- every query below selects exactly one column, on purpose, so there's
 * never any other field to accidentally include in an export. */

/** Owner-requested: any Coordinator/General Coordinator (and Admin) can
 * export any cohort's names, not just one they're personally assigned to
 * -- "no risk of data leaking since it's just a list of names." Goes
 * through export_group_member_names() (migration 0052) rather than a
 * plain select -- members_select's RLS stays scoped to
 * has_readonly_or_full_group_access(group_id) for every OTHER screen, so
 * a security-definer RPC is what actually grants this screen's
 * intentionally broader read. */
export async function getGroupMemberNamesAction(groupId: string): Promise<string[]> {
  const supabase = await createClient();
  // Paged: one request stops at PostgREST's 1,000-row cap, so a group of more
  // than 1,000 youths (Upper Room, 21 Nov 2026) exported only the first 1,000.
  // The function returns names in order; equal names are interchangeable, so a
  // tie at a page edge can't change the list.
  const rows = await fetchAllRows<{ full_name: string }>((from, to) =>
    supabase.rpc("export_group_member_names", { p_group_id: groupId }).range(from, to),
  );
  return rows.map((r) => r.full_name);
}

/** Same "servant" definition as the Servant Directory (holds a 'servant',
 * 'sub_coordinator', or 'general_coordinator' role row) -- just names, no
 * attendance/contact/etc. */
export async function getServantNamesAction(): Promise<string[]> {
  const supabase = await createClient();
  const { data: roleRows } = await supabase
    .from("user_roles")
    .select("user_id")
    .in("role", ["servant", "sub_coordinator", "general_coordinator"]);

  const userIds = Array.from(new Set((roleRows ?? []).map((r) => r.user_id)));
  if (userIds.length === 0) return [];

  const { data: profileRows } = await supabase.from("profiles").select("full_name").in("id", userIds);
  return (profileRows ?? []).map((r) => r.full_name).sort((a, b) => a.localeCompare(b));
}
