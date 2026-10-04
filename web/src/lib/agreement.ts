/** Servant Confidentiality & Privacy Agreement (migration 0086): one
 * agreement for the whole church, signed once by everyone who uses the app.
 * Shared by the front door (src/lib/supabase/proxy.ts) and the pages, so it
 * imports nothing server-only. */

export const AGREEMENT_PATH = "/security/agreement";

/** "Remind me later" during the grace period: no reminder for a day. */
export const AGREEMENT_LATER_COOKIE = "agreement_later";
export const AGREEMENT_LATER_SECONDS = 60 * 60 * 24;

/** agreement_gate(): no row means no agreement is published yet. */
export type AgreementGate = { must_sign: boolean; needs_signature: boolean; grace_until: string | null };

export function firstGateRow(data: unknown): AgreementGate | null {
  return (data as AgreementGate[] | null)?.[0] ?? null;
}

/** agreement_status_here(): one row per person in this ministry (Admins,
 * General Coordinators and the Church Admin only). */
export type AgreementStatus = {
  user_id: string;
  signature_id: number | null;
  version: number | null;
  signed_at: string | null;
  is_current: boolean;
  grace_until: string | null;
};
