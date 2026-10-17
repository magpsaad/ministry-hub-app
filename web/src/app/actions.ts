"use server";

import { createClient } from "@/lib/supabase/server";

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

