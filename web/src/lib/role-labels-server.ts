import { cache } from "react";
import { getBranding } from "@/lib/branding";
import { relabelRoleWords, roleLabels, type RoleLabels } from "@/lib/role-labels";

/** Migration 0097: this address's role words, for server components and
 * server actions (client components use useRoleLabels()). Standard words on
 * the console. React.cache()-memoized per request. */
export const getRoleLabels = cache(async (): Promise<RoleLabels> => {
  const b = await getBranding();
  return roleLabels(b.servant_label, b.sub_coordinator_label);
});

/** A database message shown to someone ("Only General Coordinators/Admins
 * can...", "please ask a servant") in this ministry's role words. */
export async function roleWords(message: string): Promise<string>;
export async function roleWords(message: string | null | undefined): Promise<string | null>;
export async function roleWords(message: string | null | undefined): Promise<string | null> {
  if (!message) return message ?? null;
  return relabelRoleWords(message, await getRoleLabels());
}
