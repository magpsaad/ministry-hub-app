"use server";

import { createClient } from "@/lib/supabase/server";
import { fetchAllRows } from "@/lib/pagination";

export type AuditReportRow = {
  occurred_at: string;
  user_id: string | null;
  user_name: string | null;
};

/** REQUIREMENTS.md §3.11 -- the 15,000-row cap is deliberate (owner's
 * explicit choice): it keeps the report's data set bounded, and doubles as
 * a soft prompt to use the Admin-only archive tool (archiveAuditLogAction)
 * once history gets long enough to bump into it. Most-recent-first, so if
 * it's ever hit, what quietly drops off is the oldest activity, not the
 * newest.
 *
 * A plain `.limit(15000)` never actually returned more than 1000 rows,
 * though -- confirmed directly: this project's Supabase instance caps a
 * single response at its configured `db-max-rows` (1000) regardless of
 * what the client asks for, silently, no error. Paged via fetchAllRows
 * (lib/pagination.ts) so the real cap is 15,000, not 1,000 -- audit_log
 * already has 4,000+ rows, well past that ceiling. */
/** Read through get_audit_report_rows() (migration 0071): General
 * Coordinators see the report too, but only its when-and-who columns --
 * the audit log itself stays Admin-only. */
export async function getAuditReportDataAction(): Promise<AuditReportRow[]> {
  const supabase = await createClient();
  const rows = (await fetchAllRows(
    (from, to) =>
      supabase
        .rpc("get_audit_report_rows")
        .order("occurred_at", { ascending: false })
        .order("id", { ascending: false })
        .range(from, to),
    1000,
    15000,
  )) as { occurred_at: string; user_id: string | null; user_name: string | null }[];

  return rows.map((r) => ({ occurred_at: r.occurred_at, user_id: r.user_id, user_name: r.user_name }));
}

export type AuditReportUser = { id: string; full_name: string };

/** Same fix, same reason as getAuditLogUsersAction() (Audit Logs'
 * equivalent) -- migration 0037. */
export async function getAuditReportUsersAction(): Promise<AuditReportUser[]> {
  const supabase = await createClient();
  const { data } = await supabase.rpc("get_audit_log_users");
  return ((data as { user_id: string; full_name: string }[] | null) ?? [])
    .map((r) => ({ id: r.user_id, full_name: r.full_name }))
    .sort((a, b) => a.full_name.localeCompare(b.full_name));
}
