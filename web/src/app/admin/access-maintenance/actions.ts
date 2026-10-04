"use server";

import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import { logAudit } from "@/lib/audit";

export type AccessProfile = { id: string; full_name: string; email: string | null; deactivated_at: string | null };

export type AccessRoleRow = {
  id: string;
  user_id: string;
  role: "admin" | "general_coordinator" | "sub_coordinator" | "servant" | "read_only";
  group_id: string | null;
  group_name: string | null;
};

export async function getAllProfilesAction(): Promise<AccessProfile[]> {
  const supabase = await createClient();
  const { data } = await supabase.from("profiles").select("id, full_name, email, deactivated_at").order("full_name");
  return data ?? [];
}

export async function getAllRoleRowsAction(): Promise<AccessRoleRow[]> {
  const supabase = await createClient();
  const { data } = await supabase.from("user_roles").select("id, user_id, role, group_id, groups(name)");
  return (data ?? []).map((r) => ({
    id: r.id,
    user_id: r.user_id,
    role: r.role,
    group_id: r.group_id,
    group_name: (r.groups as unknown as { name: string } | null)?.name ?? null,
  }));
}

/** MULTI_TENANT_PLAN.md §3.7 -- "Add existing account by email": someone
 * who already has a login (e.g. they serve in another ministry) but has
 * never signed in on this ministry's address gets a profile HERE, with no
 * role yet, so they can then be granted one below. The answer is only ever
 * "added" or "no account with that email" -- it never reveals whether, or
 * where, else they serve. Admins only (the function refuses anyone else). */
export async function addPersonByEmailAction(email: string) {
  const trimmed = email.trim();
  if (!trimmed) return { error: "Enter an email address.", profile: null };

  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return { error: "Not signed in", profile: null };

  const { data: personId, error } = await supabase.rpc("add_person_to_ministry_by_email", { p_email: trimmed });
  if (error) return { error: error.message, profile: null };

  const { data: profile } = await supabase
    .from("profiles")
    .select("id, full_name, email, deactivated_at")
    .eq("id", personId as string)
    .maybeSingle();

  await logAudit(user.id, "ADMIN_ACCESS_MAINTENANCE", { details: { action: "add_by_email", userId: personId } });
  revalidatePath("/admin/access-maintenance");
  return { error: null, profile: (profile as AccessProfile | null) ?? null };
}

/** Owner-reported: a person can hold at most one 'servant' grant at a time
 * (ministry policy -- the same rule Servant Assignments' reassign already
 * enforces, migration 0031). Granting "servant" here used to always insert
 * a fresh row, so a person who already had one (most commonly Unassigned,
 * auto-granted the moment their Checkin registration links -- lib/
 * supabase/ensure-profile.ts) ended up with two: the old one untouched,
 * plus this new one alongside it -- both Servant Profiles and Servant
 * Assignments then correctly listed them under both. Reassign the existing
 * row instead of duplicating it, same outcome Servant Assignments' own
 * "move to another cohort" control already produces. */
export async function grantRoleAction(
  userId: string,
  role: AccessRoleRow["role"],
  groupId: string | null,
) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return { error: "Not signed in", id: null };

  if (role === "servant") {
    const { data: existing } = await supabase
      .from("user_roles")
      .select("id")
      .eq("user_id", userId)
      .eq("role", "servant")
      .maybeSingle();
    if (existing) {
      const { error } = await supabase.from("user_roles").update({ group_id: groupId }).eq("id", existing.id);
      if (error) return { error: error.message, id: null };

      await logAudit(user.id, "ADMIN_ACCESS_MAINTENANCE", { groupId, details: { action: "reassign", userId, role } });
      revalidatePath("/admin/access-maintenance");
      return { error: null, id: existing.id as string };
    }
  }

  const { data, error } = await supabase
    .from("user_roles")
    .insert({ user_id: userId, role, group_id: groupId })
    .select("id")
    .single();
  if (error) return { error: error.message, id: null };

  await logAudit(user.id, "ADMIN_ACCESS_MAINTENANCE", { groupId, details: { action: "grant", userId, role } });
  revalidatePath("/admin/access-maintenance");
  return { error: null, id: data.id as string };
}

export async function revokeRoleAction(roleRowId: string) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return { error: "Not signed in" };

  const { error } = await supabase.from("user_roles").delete().eq("id", roleRowId);
  if (error) return { error: error.message };

  await logAudit(user.id, "ADMIN_ACCESS_MAINTENANCE", { details: { action: "revoke", roleRowId } });
  revalidatePath("/admin/access-maintenance");
  return { error: null };
}

/** Owner-reported: removing a servant from Servant Profiles only ever
 * revoked their 'servant' role grant (remove_servant(), migration 0022) --
 * the underlying profiles row was left behind, orphaned (no role left, so
 * invisible everywhere role-filtered) but still listed here, with no way
 * to act on it. This is the real, full delete -- migration 0051's RPC
 * refuses if the person has left behind any actual history, so it can't
 * be used to silently destroy someone's genuine activity. */
export async function removeProfileCompletelyAction(profileId: string) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return { error: "Not signed in" };

  const { error } = await supabase.rpc("remove_profile_completely", { p_profile_id: profileId });
  if (error) return { error: error.message };

  await logAudit(user.id, "ADMIN_ACCESS_MAINTENANCE", { details: { action: "remove_profile", profileId } });
  revalidatePath("/admin/access-maintenance");
  return { error: null };
}

/** Owner-requested (3 Oct 2026): someone who no longer serves is marked
 * Deactivated instead of removed -- their history stays, in case they come
 * back. Deactivating also removes every role they hold here; while
 * deactivated nobody can give them a role by any path (migration 0077's
 * guard), until an Admin reactivates them. Reactivating gives no role back. */
export async function setPersonDeactivatedAction(profileId: string, deactivated: boolean) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return { error: "Not signed in", deactivatedAt: null };

  const { error } = await supabase.rpc("set_person_deactivated", {
    p_profile_id: profileId,
    p_deactivated: deactivated,
  });
  if (error) return { error: error.message, deactivatedAt: null };

  const { data: profile } = await supabase.from("profiles").select("deactivated_at").eq("id", profileId).maybeSingle();

  await logAudit(user.id, "ADMIN_ACCESS_MAINTENANCE", {
    details: { action: deactivated ? "deactivate" : "reactivate", userId: profileId },
  });
  revalidatePath("/admin/access-maintenance");
  return { error: null, deactivatedAt: (profile?.deactivated_at as string | null) ?? null };
}

/** Owner-requested: a servant with two accounts (signed in with a different
 * email) -- unlike Remove Person, both accounts may have real history, and
 * neither side's should be lost. `keepId` stays; `removeId`'s attendance,
 * outreach, assignments, calendar events, role grants, and audit history
 * all move onto `keepId` (migration 0056), then `removeId`'s now-empty
 * profile is deleted. See that migration for exactly what does and doesn't
 * carry over, and why the underlying auth.users login isn't touched. */
export async function mergeServantAccountsAction(keepId: string, removeId: string) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return { error: "Not signed in" };

  const { error } = await supabase.rpc("merge_servant_accounts", { p_keep_id: keepId, p_remove_id: removeId });
  if (error) return { error: error.message };

  await logAudit(user.id, "ADMIN_ACCESS_MAINTENANCE", { details: { action: "merge_accounts", keepId, removeId } });
  revalidatePath("/admin/access-maintenance");
  return { error: null };
}
