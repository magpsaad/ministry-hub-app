import { createClient } from "@/lib/supabase/server";

export type TransitionPreviewGroup = {
  id: string;
  name: string;
  cohortYear: number | null;
  ladderPosition: number;
  nextName: string | null; // null = this row is archived by the transition (the old terminal group)
};

export type TransitionPreview = {
  groups: TransitionPreviewGroup[];
  oldTerminalGroupName: string | null; // absorbed and archived this transition, if it exists
  newTerminalGroupName: string | null; // the row one below terminal, becoming the new terminal -- its computed next name
  suggestedNewCohortYear: number;
  /** The row one below terminal's *current* ladder position (its "Yr N"
   * label right now, before this transition) and the terminal position it's
   * about to become ("Yr N+1+") -- both admin-configurable via Add/Remove
   * Group (§6.9), so the UI can't hardcode "Yr 4"/"Yr 5+" text anymore. */
  currentNewTerminalPosition: number | null;
  currentTerminalPosition: number | null;
  /** False when the active ladder is too short to run a transition (fewer
   * than one active tier between pre-entry and terminal) -- see
   * run_group_transition()'s own guard, migration 0030. */
  canTransition: boolean;
  blockedReason: string | null;
};

/** REQUIREMENTS.md §5 -- everything the Group Transition confirmation
 * screen needs to show before the Admin commits: every group's current vs.
 * next-name preview, which old terminal-tier row (if any) is about to be
 * absorbed and archived, and a suggested year for the new incoming
 * pre-entry cohort. Mirrors run_group_transition() (migration 0028/0030/0033)
 * exactly: the row one below terminal becomes the new terminal row (same
 * row, name left unchanged); the OLD terminal row is what merges in and
 * archives. Terminal position is now derived from the actual data (the
 * highest active ladder_position), not hardcoded to 5, since the ladder
 * length is admin-configurable (§6.9). */
export async function getTransitionPreview(): Promise<TransitionPreview> {
  const supabase = await createClient();

  const [{ data: groupRows }, { data: settings }] = await Promise.all([
    supabase
      .from("groups")
      .select("id, name, cohort_year, ladder_position")
      .eq("is_archived", false)
      .order("ladder_position"),
    supabase.from("app_settings").select("group_name_template").single(),
  ]);

  // No hard-coded naming fallback (MULTI_TENANT_PLAN.md §10, A5): with no
  // template configured, names are simply left as they are.
  const template: string | null = settings?.group_name_template ?? null;
  const rows = groupRows ?? [];
  const positions = rows.map((g) => g.ladder_position);
  const terminalPosition = positions.length > 0 ? Math.max(...positions) : null;
  const newTerminalPosition = terminalPosition !== null ? terminalPosition - 1 : null;
  const canTransition = terminalPosition !== null && newTerminalPosition !== null && newTerminalPosition >= 1;

  function renderName(cohortYear: number | null, positionLabel: string) {
    if (cohortYear === null || template === null) return null;
    return template.replace("{cohort_year}", String(cohortYear)).replace("{position_label}", positionLabel);
  }

  const groups: TransitionPreviewGroup[] = rows.map((g) => {
    if (g.ladder_position === terminalPosition) {
      // The OLD terminal row -- absorbed into the row one below it and archived this transition.
      return { id: g.id, name: g.name, cohortYear: g.cohort_year, ladderPosition: g.ladder_position, nextName: null };
    }
    if (g.ladder_position === newTerminalPosition) {
      // Becomes the NEW terminal row -- keeps its current name unchanged
      // (owner's call, migration 0033: no formula assumed to still apply).
      return { id: g.id, name: g.name, cohortYear: g.cohort_year, ladderPosition: g.ladder_position, nextName: g.name };
    }
    const nextName = renderName(g.cohort_year, String(g.ladder_position + 1)) ?? g.name;
    return { id: g.id, name: g.name, cohortYear: g.cohort_year, ladderPosition: g.ladder_position, nextName };
  });

  const oldTerminal = rows.find((g) => g.ladder_position === terminalPosition);
  const newTerminal = rows.find((g) => g.ladder_position === newTerminalPosition);
  const currentPreEntry = rows.find((g) => g.ladder_position === 0);
  const suggestedNewCohortYear = currentPreEntry?.cohort_year ? currentPreEntry.cohort_year + 1 : new Date().getFullYear();

  return {
    groups,
    oldTerminalGroupName: canTransition ? (oldTerminal?.name ?? null) : null,
    newTerminalGroupName: canTransition ? (newTerminal?.name ?? null) : null,
    suggestedNewCohortYear,
    currentNewTerminalPosition: newTerminalPosition,
    currentTerminalPosition: terminalPosition,
    canTransition,
    blockedReason: canTransition
      ? null
      : "The active ladder needs at least one tier between the pre-entry group and the terminal group before a Group Transition can run -- use Add Group on the App Settings screen first.",
  };
}
