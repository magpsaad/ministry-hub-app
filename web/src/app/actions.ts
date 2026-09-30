"use server";

import { createClient } from "@/lib/supabase/server";
import { logAudit } from "@/lib/audit";

/**
 * REQUIREMENTS.md §6.1 -- a random active verse, shown along the bottom
 * edge of the cohort banner (SIDE_MENU_PLAN.md D9). Returns null
 * gracefully if the verses list is empty (nothing seeded yet) rather than
 * erroring.
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
 * menu's cohort switcher. (The "last opened" cookie for the landing rule,
 * SIDE_MENU_PLAN.md D6, is set in the browser instead: setting a cookie
 * from a server action makes Next.js re-render the whole current page.) */
export async function logGroupSelectedAction(groupId: string) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return;
  await logAudit(user.id, "GROUP_SELECTED", { groupId });
}

