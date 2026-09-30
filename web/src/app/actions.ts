"use server";

import { cookies } from "next/headers";
import { createClient } from "@/lib/supabase/server";
import { logAudit } from "@/lib/audit";
import { getAppSettings } from "@/lib/app-settings";
import { buildSwitcherEntries, getAccessibleGroups, LAST_GROUP_COOKIE, type SwitcherEntry } from "@/lib/groups";
import { getPendingServantsCount } from "@/lib/pending-servants";
import { getAccessSummary } from "@/lib/roles";

/**
 * REQUIREMENTS.md §6.1 -- a random active verse, shown along the bottom
 * edge of the cohort banner (SIDE_MENU_PLAN.md D9). Returns null gracefully if the verses list is empty (nothing seeded
 * yet) rather than erroring.
 */
export async function getRandomVerseAction(): Promise<{ text: string; reference: string | null } | null> {
  const supabase = await createClient();
  const { data } = await supabase
    .from("verses")
    .select("text, reference")
    .eq("is_active", true);

  if (!data || data.length === 0) return null;
  return data[Math.floor(Math.random() * data.length)];
}

/** REQUIREMENTS.md §3.11 -- logged when a group is opened from the side
 * menu's cohort switcher. Also remembers it for the landing rule
 * (SIDE_MENU_PLAN.md D6), which only uses it for someone serving several
 * cohorts. */
export async function logGroupSelectedAction(groupId: string) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return;
  (await cookies()).set(LAST_GROUP_COOKIE, groupId, {
    httpOnly: true,
    sameSite: "lax",
    secure: true,
    path: "/",
    maxAge: 60 * 60 * 24 * 365,
  });
  await logAudit(user.id, "GROUP_SELECTED", { groupId });
}

export type MenuData = {
  isAdmin: boolean;
  isCoordinator: boolean;
  isAdminOrGeneralCoordinator: boolean;
  pendingServantsCount: number;
  universityLabel: string;
  groupLabel: string;
  appVersion: string;
  cohorts: SwitcherEntry[];
};

/** SIDE_MENU_PLAN.md §3.4 -- everything the side menu shows, fetched only
 * when the burger is first tapped (never on page or tab loads), so the menu
 * adds nothing to tab-switching time. */
export async function getMenuDataAction(): Promise<MenuData | null> {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return null;

  const [access, settings, groups, pendingServantsCount] = await Promise.all([
    getAccessSummary(user.id),
    getAppSettings(),
    getAccessibleGroups(),
    getPendingServantsCount(),
  ]);
  const isAdminOrGeneralCoordinator = access.isAdmin || access.isGeneralCoordinator;

  return {
    isAdmin: access.isAdmin,
    isCoordinator: access.isCoordinator || access.isAdmin,
    isAdminOrGeneralCoordinator,
    pendingServantsCount: isAdminOrGeneralCoordinator ? pendingServantsCount : 0,
    universityLabel: settings.university_label,
    groupLabel: settings.group_label,
    appVersion: settings.app_version,
    cohorts: buildSwitcherEntries(groups, access, `All ${settings.group_label}s Combined`),
  };
}
