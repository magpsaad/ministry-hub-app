/** GROUP_LADDER_PLAN.md §3.1 -- the same name rendering as the database's
 * render_group_name() (migration 0069), for previews on screen. No server
 * imports, so client components can use it.
 *   {level}          the displayed number (level + the ministry's offset);
 *                    {position_label} is its old spelling
 *   {label}          the ministry's level word ("Yr", "Gr")
 *   {cohort_year}    the group's cohort year
 *   {gender}         the group's gender ("Girls"), migration 0073
 *   {patron_saint}   the group's patron saint ("St. Marina"), 0073
 * Spaces and dashes left at either end by an empty placeholder are trimmed,
 * and a double space one leaves in the middle is squeezed. */
export function renderGroupName(
  pattern: string,
  cohortYear: number | null,
  level: number,
  offset: number,
  label: string,
  gender: string | null = null,
  patronSaint: string | null = null,
): string {
  const shown = String(level + offset);
  return pattern
    .replaceAll("{cohort_year}", cohortYear === null ? "" : String(cohortYear))
    .replaceAll("{level}", shown)
    .replaceAll("{position_label}", shown)
    .replaceAll("{label}", label)
    .replaceAll("{gender}", (gender ?? "").trim())
    .replaceAll("{patron_saint}", (patronSaint ?? "").trim())
    .replace(/\s{2,}/g, " ")
    .replace(/^[\s-]+|[\s-]+$/g, "");
}

/** "Yr 3", "Grade 10" -- a level as people see it. */
export function levelText(level: number, label: string, offset: number): string {
  return `${label} ${level + offset}`.trim();
}

/** One checkbox of the combined view's cohort filter, and the groups it
 * stands for. */
export type CohortFilterOption = { key: string; label: string; groupIds: string[] };

/**
 * Owner-requested (30 Sep 2026): the "All ... Combined" view offers one
 * checkbox per level, not per group -- a High School's 16 classes become its
 * 4 grades, each one ticking all of that grade's classes. A level with a
 * single group keeps that group's own name (so a University ministry's
 * filters look as before). `perGroup` (a Coordinator's own combined view)
 * keeps one checkbox per group. `groups` must be in display order.
 */
export function cohortFilterOptions(
  groups: { id: string; name: string; ladder_position: number }[],
  perGroup: boolean,
  label: string,
  offset: number,
): CohortFilterOption[] {
  if (perGroup) return groups.map((g) => ({ key: g.id, label: g.name, groupIds: [g.id] }));
  const byLevel = new Map<number, { id: string; name: string }[]>();
  for (const g of groups) {
    if (!byLevel.has(g.ladder_position)) byLevel.set(g.ladder_position, []);
    byLevel.get(g.ladder_position)!.push(g);
  }
  return Array.from(byLevel.entries()).map(([level, members]) => ({
    key: `level-${level}`,
    label: members.length === 1 ? members[0].name : levelText(level, label, offset),
    groupIds: members.map((g) => g.id),
  }));
}

export const PATTERN_PLACEHOLDER =/\{(level|cohort_year|position_label)\}/;
