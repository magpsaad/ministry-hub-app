import { cache } from "react";
import { createClient } from "@/lib/supabase/server";

export type Role = "admin" | "general_coordinator" | "sub_coordinator" | "servant" | "read_only";

export type AccessSummary = {
  roles: { role: Role; group_id: string | null }[];
  /** MULTI_TENANT_PLAN.md D2/D3 -- the church-wide owner role. */
  isChurchAdmin: boolean;
  /** An Admin of THIS ministry -- by role grant, or as the Church Admin,
   * who acts as an Admin of whichever ministry's address they're on (§3.5). */
  isAdmin: boolean;
  isGeneralCoordinator: boolean;
  isSubCoordinator: boolean;
  isServant: boolean;
  /** REQUIREMENTS.md §4.2 -- read-only exception access to a cohort the
   * user doesn't otherwise serve; always layered on top of a real role. */
  isReadOnly: boolean;
  /** REQUIREMENTS.md §6.1 -- shows the Coordinator Corner (general or sub). */
  isCoordinator: boolean;
};

/**
 * REQUIREMENTS.md §4 -- a user can hold multiple role rows at once; the
 * landing page and every permission check are driven by the union of them,
 * never a single "the" role.
 *
 * The role grants are this ministry's only -- the security rule returns no
 * other ministry's rows (MULTI_TENANT_PLAN.md §3.2).
 *
 * React.cache()-memoized per request (per userId): the page, its layout and
 * helpers used to each query user_roles separately for the same person.
 */
export const getAccessSummary = cache(async (userId: string): Promise<AccessSummary> => {
  const supabase = await createClient();
  const [{ data }, { data: churchAdmin }] = await Promise.all([
    supabase.from("user_roles").select("role, group_id").eq("user_id", userId),
    supabase.rpc("is_church_admin"),
  ]);

  const roles = (data ?? []) as AccessSummary["roles"];
  const has = (r: Role) => roles.some((row) => row.role === r);
  const isChurchAdmin = churchAdmin === true;

  return {
    roles,
    isChurchAdmin,
    isAdmin: has("admin") || isChurchAdmin,
    isGeneralCoordinator: has("general_coordinator"),
    isSubCoordinator: has("sub_coordinator"),
    isServant: has("servant"),
    isReadOnly: has("read_only"),
    isCoordinator: has("general_coordinator") || has("sub_coordinator"),
  };
});

/**
 * Owner-reported (Read-Only role bug follow-up): whether this person can
 * edit a specific cohort's data, not just view it -- mirrors
 * has_group_access() exactly (migration 0024/0057): Admin/General
 * Coordinator can edit anywhere, otherwise only if they hold some
 * NON-read_only role row at that exact group. A person can hold Read-Only
 * at one cohort and a real role (servant/sub_coordinator) at another, so
 * this is always resolved per-group, never as a single blanket flag.
 */
export function canEditGroup(access: AccessSummary, groupId: string): boolean {
  return (
    access.isAdmin ||
    access.isGeneralCoordinator ||
    access.roles.some((r) => r.group_id === groupId && r.role !== "read_only")
  );
}
