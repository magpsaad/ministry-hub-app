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
};

/** Self-registered servants (0014_servant_self_registration.sql) awaiting
 * Admin/General Coordinator review -- not yet linked to a real account. */
export async function getPendingServants(): Promise<PendingServant[]> {
  const supabase = await createClient();
  const { data: pending } = await supabase
    .from("pending_servants")
    .select(
      "id, full_name, phone, email, father_of_confession, gender, registration_comments, submitted_at, approved_at",
    )
    .is("resulting_profile_id", null)
    .order("submitted_at", { ascending: false });

  const rows = pending ?? [];
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
