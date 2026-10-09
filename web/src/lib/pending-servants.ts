import { createClient } from "@/lib/supabase/server";

export type PendingServant = {
  id: string;
  full_name: string;
  phone: string | null;
  email: string | null;
  father_of_confession: string | null;
  gender: string | null;
  registration_comments: string | null;
  submitted_at: string;
  approved_at: string | null;
  checkInCount: number;
  /** Migration 0108 -- approved but not fully onboarded yet: hasn't opened
   * the app since approval, or hasn't signed the current agreement. */
  stage?: "not_opened" | "agreement" | null;
  approved_by_name?: string | null;
};

/** Self-registered servants (0014_servant_self_registration.sql) awaiting
 * Admin/General Coordinator review, and (owner-requested 9 Oct 2026,
 * migration 0108) approved ones who aren't fully onboarded yet: they stay
 * listed until they've opened the app and signed the agreement. */
export async function getPendingServants(): Promise<PendingServant[]> {
  const supabase = await createClient();
  const [{ data: pending }, { data: onboarding }] = await Promise.all([
    supabase
      .from("pending_servants")
      .select(
        "id, full_name, phone, email, father_of_confession, gender, registration_comments, submitted_at, approved_at",
      )
      .is("resulting_profile_id", null)
      .is("approved_at", null)
      .order("submitted_at", { ascending: false }),
    supabase.rpc("pending_onboarding"),
  ]);

  const rows = [
    ...(pending ?? []).map((r) => ({ ...r, stage: null, approved_by_name: null })),
    ...((onboarding ?? []) as Omit<PendingServant, "checkInCount">[]),
  ].sort((a, b) => b.submitted_at.localeCompare(a.submitted_at));
  if (rows.length === 0) return [];

  const { data: attendance } = await supabase
    .from("pending_servant_attendance")
    .select("pending_servant_id")
    .in(
      "pending_servant_id",
      rows.map((r) => r.id),
    );

  const countByPending = new Map<string, number>();
  for (const a of attendance ?? []) {
    countByPending.set(a.pending_servant_id, (countByPending.get(a.pending_servant_id) ?? 0) + 1);
  }

  return rows.map((r) => ({ ...r, checkInCount: countByPending.get(r.id) ?? 0 }));
}

/** Lightweight count for the landing page's "Pending Servants" button badge:
 * only requests still waiting for someone to approve them (QA G-2). An
 * approved person who hasn't signed in yet still shows on the Pending
 * Servants screen (as approved), but needs no action, so isn't counted. */
export async function getPendingServantsCount(): Promise<number> {
  const supabase = await createClient();
  const { count } = await supabase
    .from("pending_servants")
    .select("id", { count: "exact", head: true })
    .is("resulting_profile_id", null)
    .is("approved_at", null);
  return count ?? 0;
}
