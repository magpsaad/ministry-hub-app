import { getActiveMinistry } from "@/lib/ministry-context";
import { cachedUniversities } from "@/lib/ministry-cache";

export type University = {
  id: string;
  name: string;
  proximity: "Local" | "Regional" | "Abroad" | "Unknown";
};

/** This ministry's schools, from the shared settings copy (owner-approved
 * 17 Oct 2026, lib/ministry-cache.ts); School Maintenance refreshes it. */
export async function getUniversities(): Promise<University[]> {
  // A failed read isn't kept; the page carries on with no list, as before.
  return cachedUniversities<University>(await getActiveMinistry()).catch(() => []);
}
