"use server";

import { getActiveMinistry } from "@/lib/ministry-context";
import { cachedActiveVerses } from "@/lib/ministry-cache";

/**
 * REQUIREMENTS.md §6.1 -- a random active verse, shown along the bottom
 * edge of the cohort banner (SIDE_MENU_PLAN.md D9). Returns null
 * gracefully if the verses list is empty (nothing seeded yet) rather than
 * erroring. The verses come from the shared settings copy (owner-approved
 * 17 Oct 2026, lib/ministry-cache.ts); Verse Maintenance refreshes it.
 */
export async function getRandomVerseAction(): Promise<{ text: string; reference: string | null } | null> {
  // A failed read isn't kept; the banner just shows no verse, as before.
  const data = await cachedActiveVerses(await getActiveMinistry()).catch(() => []);
  if (data.length === 0) return null;
  return data[Math.floor(Math.random() * data.length)];
}

