import { createClient } from "@/lib/supabase/server";

/** D12 -- how two or more graduating groups enter hand-over. */
export type HandOverMode = "one" | "by_gender" | "separate";

export type TransitionInput = {
  newPreEntryCohortYear: number;
  /** Blank = the name the ministry's default pattern gives. */
  newPreEntryName?: string;
  /** Blank entries = the names the hand-over pattern gives. */
  handOverNames?: string[];
  handOverMode?: HandOverMode;
};

type Person = { person: string; role: string; from: string };

/** What a Group Transition does (or did), as reported by the database
 * (GROUP_LADDER_PLAN.md §4.2). The preview is the run itself, undone, so
 * the two can never disagree. */
export type TransitionReport = {
  /** A business rule stopped it (e.g. two groups would get the same name). */
  error?: string;
  blocked: boolean;
  /** Blocked (D6): who is still in the hand-over group(s). */
  occupant_count?: number;
  occupants?: { id: string; name: string; group: string }[];
  hand_over_groups?: string[];
  mode?: HandOverMode;
  graduating?: string[];
  hand_over_names?: string[];
  hand_over_youths?: number;
  unknown_gender?: string[];
  new_pre_entry?: { name: string; cohort_year: number };
  new_level_one?: string;
  grants_moved?: Person[];
  grants_dropped?: Person[];
  assignments_cleared?: { servant: string; count: number }[];
  assignments_cleared_total?: number;
  extra_hand_over_archived?: string[];
  groups?: {
    id: string;
    old_name: string;
    old_kind: string;
    old_level: number;
    new_name: string;
    new_kind: string;
    new_level: number;
    archived: boolean;
  }[];
  new_groups?: { name: string; kind: string; level: number }[];
};

function rpcArgs(input: TransitionInput) {
  return {
    p_new_pre_entry_cohort_year: input.newPreEntryCohortYear,
    p_new_pre_entry_name: input.newPreEntryName?.trim() || null,
    p_new_terminal_names: input.handOverNames?.length ? input.handOverNames.map((n) => n.trim()) : null,
    p_handover_mode: input.handOverMode ?? null,
  };
}

/** preview_group_transition() (migration 0069): the run, rolled back. */
export async function previewGroupTransition(input: TransitionInput): Promise<TransitionReport> {
  const supabase = await createClient();
  const { data, error } = await supabase.rpc("preview_group_transition", rpcArgs(input));
  if (error) return { blocked: false, error: error.message };
  return data as TransitionReport;
}

/** run_group_transition() (migration 0069): everything in one transaction. */
export async function runGroupTransition(input: TransitionInput): Promise<TransitionReport> {
  const supabase = await createClient();
  const { data, error } = await supabase.rpc("run_group_transition", rpcArgs(input));
  if (error) return { blocked: false, error: error.message };
  return data as TransitionReport;
}

/** The year the new pre-entry group most likely represents: one after the
 * current pre-entry group's, else this year. */
export async function suggestedNewCohortYear(): Promise<number> {
  const supabase = await createClient();
  const { data } = await supabase
    .from("groups")
    .select("cohort_year")
    .eq("kind", "pre_entry")
    .eq("is_archived", false)
    .maybeSingle();
  return data?.cohort_year ? data.cohort_year + 1 : new Date().getFullYear();
}
