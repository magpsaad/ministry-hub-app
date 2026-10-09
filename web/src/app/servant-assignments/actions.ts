"use server";

import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import { logAudit } from "@/lib/audit";
import { roleWords } from "@/lib/role-labels-server";

export type AddableRole = "servant" | "sub_coordinator" | "read_only";

/** GROUP_LADDER_PLAN.md Q6 -- how many active youths in a group are
 * assigned to this person, i.e. the assignments a move would clear (the
 * screen warns first). */
export async function countAssignmentsInGroupAction(userId: string, groupId: string): Promise<number> {
  const supabase = await createClient();
  const { count } = await supabase
    .from("members")
    .select("id", { count: "exact", head: true })
    .eq("group_id", groupId)
    .eq("assigned_servant_id", userId)
    .eq("status", "active");
  return count ?? 0;
}

/** General Coordinator/Admin only -- enforced by reassign_role_group itself
 * (security definer, checks is_admin_or_general_coordinator()). Row-scoped
 * -- reassigns exactly the Servant grant identified by roleId, never any
 * other grant the same person might hold (migration 0031; replaces the old
 * reassign_servant_group, which updated every 'servant' row for a user at
 * once and broke the moment someone held two). Passing groupId=null
 * reassigns to Unassigned. */
export async function reassignRoleGroupAction(roleId: string, groupId: string | null) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return { error: "Not signed in" };

  const { error } = await supabase.rpc("reassign_role_group", { p_role_id: roleId, p_group_id: groupId });
  if (error) return { error: await roleWords(error.message) };

  await logAudit(user.id, "SERVANT_GROUP_UPDATED", { groupId, details: { roleId } });
  revalidatePath("/servant-assignments");
  return { error: null };
}

/** Removes one specific Sub-Coordinator/Read-Only (or, defensively,
 * Servant) grant -- never Admin/General Coordinator, which revoke_role_grant
 * itself refuses (those stay Access-Maintenance-only). */
export async function revokeRoleGrantAction(roleId: string) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return { error: "Not signed in" };

  const { error } = await supabase.rpc("revoke_role_grant", { p_role_id: roleId });
  if (error) return { error: await roleWords(error.message) };

  await logAudit(user.id, "SERVANT_GROUP_UPDATED", { details: { action: "revoke", roleId } });
  revalidatePath("/servant-assignments");
  return { error: null };
}

/** Migration 0106: make someone Coordinator of a grade (or grade + gender)
 * -- one grant, which the database keeps in step with the groups there.
 * General Coordinators/Admins only (grant_coordinator_scope checks). Also
 * used by Access Maintenance. */
export async function grantCoordinatorScopeAction(userId: string, ladderPosition: number, gender: string | null) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return { error: "Not signed in" };

  const { error } = await supabase.rpc("grant_coordinator_scope", {
    p_user_id: userId,
    p_ladder_position: ladderPosition,
    p_gender: gender,
  });
  if (error) return { error: await roleWords(error.message) };

  await logAudit(user.id, "SERVANT_GROUP_UPDATED", { details: { action: "grant_grade", userId, ladderPosition, gender } });
  revalidatePath("/servant-assignments");
  revalidatePath("/admin/access-maintenance");
  return { error: null };
}

/** Removes a grade-level Coordinator grant and all its groups' grants. */
export async function revokeCoordinatorScopeAction(scopeId: string) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return { error: "Not signed in" };

  const { error } = await supabase.rpc("revoke_coordinator_scope", { p_scope_id: scopeId });
  if (error) return { error: await roleWords(error.message) };

  await logAudit(user.id, "SERVANT_GROUP_UPDATED", { details: { action: "revoke_grade", scopeId } });
  revalidatePath("/servant-assignments");
  revalidatePath("/admin/access-maintenance");
  return { error: null };
}

/** Adds another Servant/Sub-Coordinator/Read-Only grant to someone who
 * already holds at least one grant (grant_servant_role itself refuses
 * otherwise -- a brand-new person's first grant stays Access Maintenance's
 * job, deliberately, so this screen doesn't duplicate that one's person
 * search). Returns the new grant's id so the UI can patch it into local
 * state without a full refetch. */
export async function grantServantRoleAction(userId: string, role: AddableRole, groupId: string | null) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return { error: "Not signed in", id: null };

  const { data, error } = await supabase.rpc("grant_servant_role", {
    p_user_id: userId,
    p_role: role,
    p_group_id: groupId,
  });
  if (error) return { error: await roleWords(error.message), id: null };

  await logAudit(user.id, "SERVANT_GROUP_UPDATED", { groupId, details: { action: "grant", userId, role } });
  revalidatePath("/servant-assignments");
  return { error: null, id: data as string };
}
