"use server";

import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";

/** Refresh QA from production (migration 0068, QA only). Each action is one
 * call to a database function in the qa schema that refuses anyone who
 * isn't a Church Admin and only ever reads production. These refuse to run
 * outside the QA environment as well. */

export type QaOnlyAccessRow = {
  ministry_id: string;
  user_id: string;
  email: string | null;
  full_name: string;
  role: string;
  group_name: string;
  kept_before: boolean;
};

export type KeepItem = { ministry_id: string; user_id: string; role: string; group_name: string };

export type RefreshReport = {
  ministries: string[];
  dry_run: boolean;
  seconds: number;
  backup: string | null;
  tables: Record<string, { before: number; production: number; after: number }>;
  kept_applied: KeepItem[];
  kept_failed: (KeepItem & { reason: string })[];
};

const notQa = () => process.env.NEXT_PUBLIC_APP_ENV !== "qa";

export async function getQaOnlyAccessAction(ministries: string[]) {
  if (notQa()) return { error: "Refresh is only available in the QA console.", rows: [] as QaOnlyAccessRow[] };
  if (ministries.length === 0) return { error: null, rows: [] as QaOnlyAccessRow[] };
  const supabase = await createClient();
  const { data, error } = await supabase.rpc("refresh_qa_only_access", { p_ministries: ministries });
  if (error) return { error: error.message, rows: [] as QaOnlyAccessRow[] };
  return { error: null, rows: (data ?? []) as QaOnlyAccessRow[] };
}

export async function runRefreshAction(ministries: string[], keep: KeepItem[], dryRun: boolean) {
  if (notQa()) return { error: "Refresh is only available in the QA console.", report: null };
  if (ministries.length === 0) return { error: "Choose at least one ministry.", report: null };
  const supabase = await createClient();
  const { data, error } = await supabase.rpc("refresh_from_prod", {
    p_ministries: ministries,
    p_keep: keep,
    p_dry_run: dryRun,
  });
  if (error) return { error: error.message, report: null };
  // Every QA page shows the refreshed ministries' data from now on.
  if (!dryRun) revalidatePath("/", "layout");
  return { error: null, report: data as RefreshReport };
}
