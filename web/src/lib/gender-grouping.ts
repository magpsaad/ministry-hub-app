import { roleLabels, type RoleLabels } from "@/lib/role-labels";

/**
 * REQUIREMENTS.md §6.13 -- shared between Servant Assignments and Servant
 * Profiles' Categorical view (owner asked for identical "n Female
 * Servants" / "n Male Servants" subheadings, within each cohort, on both
 * screens). "Other" covers a missing/non-binary gender value -- real data
 * doesn't have any today, but this never silently drops anyone from the
 * list the way a strict Female/Male split would.
 */
export function groupByGender<T>(items: T[], getGender: (item: T) => string | null): { female: T[]; male: T[]; other: T[] } {
  const female: T[] = [];
  const male: T[] = [];
  const other: T[] = [];
  for (const item of items) {
    const g = getGender(item);
    if (g === "Female") female.push(item);
    else if (g === "Male") male.push(item);
    else other.push(item);
  }
  return { female, male, other };
}

/** "3 Female Servants" / "1 Female Servant" / "2 Other" -- other never
 * carries the "Servants" suffix since it's not a real ministry-defined
 * bucket, just an overflow catch-all. */
export function genderSubheading(kind: "Female" | "Male" | "Other", n: number, L: RoleLabels = roleLabels()): string {
  if (kind === "Other") return `${n} Other`;
  return `${n} ${kind} ${n === 1 ? L.servant : L.servants}`;
}
