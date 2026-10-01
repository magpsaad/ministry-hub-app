/** GROUP_LADDER_PLAN.md §3.1 -- the same name rendering as the database's
 * render_group_name() (migration 0069), for previews on screen. No server
 * imports, so client components can use it.
 *   {level}          the displayed number (level + the ministry's offset);
 *                    {position_label} is its old spelling
 *   {label}          the ministry's level word ("Yr", "Gr")
 *   {cohort_year}    the group's cohort year
 * Spaces and dashes left at either end by an empty placeholder are trimmed. */
export function renderGroupName(
  pattern: string,
  cohortYear: number | null,
  level: number,
  offset: number,
  label: string,
): string {
  const shown = String(level + offset);
  return pattern
    .replaceAll("{cohort_year}", cohortYear === null ? "" : String(cohortYear))
    .replaceAll("{level}", shown)
    .replaceAll("{position_label}", shown)
    .replaceAll("{label}", label)
    .replace(/^[\s-]+|[\s-]+$/g, "");
}

/** "Yr 3", "Grade 10" -- a level as people see it. */
export function levelText(level: number, label: string, offset: number): string {
  return `${label} ${level + offset}`.trim();
}

export const PATTERN_PLACEHOLDER = /\{(level|cohort_year|position_label)\}/;
