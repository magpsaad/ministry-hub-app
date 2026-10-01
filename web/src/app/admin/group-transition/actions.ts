"use server";

import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import {
  previewGroupTransition,
  runGroupTransition,
  type TransitionInput,
  type TransitionReport,
} from "@/lib/group-transition";
import { getServantAssignmentsRoster, type AssignmentPerson } from "@/lib/servant-assignments";
import { getAccessibleGroups } from "@/lib/groups";
import type { GroupSummary } from "@/lib/groups";

/** For the post-transition "Review Servant Assignments" step -- fetched
 * fresh, since group assignments just changed. Regular groups only (no
 * role can be given on a hidden group). */
export async function getPostTransitionReviewDataAction(): Promise<{
  people: AssignmentPerson[];
  groups: GroupSummary[];
}> {
  const [people, groups] = await Promise.all([getServantAssignmentsRoster(), getAccessibleGroups()]);
  return { people, groups: groups.filter((g) => g.kind === "regular") };
}

/** GROUP_LADDER_PLAN.md §4.5 -- what the transition would do with these
 * choices (the run itself, undone by the database). */
export async function previewTransitionAction(input: TransitionInput): Promise<TransitionReport> {
  return previewGroupTransition(input);
}

/** D6 -- archive everyone still in the hand-over group(s). Their records,
 * attendance and outreach are kept. Returns how many were archived. */
export async function archiveHandOverAction(): Promise<{ error: string | null; count?: number }> {
  const supabase = await createClient();
  const { data, error } = await supabase.rpc("archive_terminal_members");
  if (error) return { error: error.message };
  revalidatePath("/", "layout");
  return { error: null, count: data as number };
}

/** The transition itself, all in one database transaction (migration
 * 0069), which also writes the GROUP_TRANSITION_RUN audit entry. */
export async function runGroupTransitionAction(input: TransitionInput): Promise<TransitionReport> {
  const report = await runGroupTransition(input);
  if (!report.error) revalidatePath("/", "layout");
  return report;
}
