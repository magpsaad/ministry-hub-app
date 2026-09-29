import { createClient } from "@/lib/supabase/server";

export type CheckInFlow = {
  isServant: boolean;
  flowType: "check_in_and_intake" | "intake_only";
  label: string;
  /** The ministry the scanned QR code belongs to (MULTI_TENANT_PLAN.md
   * §3.2) -- every check-in function works in this ministry only. */
  ministryId: string;
};

/** Bootstrap call for the public check-in page (REQUIREMENTS.md §6.11/§6.12)
 * -- resolves the token to a group/servant flow before the client decides
 * which list/mark/submit RPCs to call next. Returns null for an invalid or
 * unknown token, or a ministry that's been switched off (never throws to
 * the caller). */
export async function getCheckInFlow(token: string): Promise<CheckInFlow | null> {
  const supabase = await createClient();
  const { data, error } = await supabase.rpc("checkin_get_flow", { p_token: token }).single();
  if (error || !data) return null;
  const row = data as { is_servant: boolean; flow_type: CheckInFlow["flowType"]; label: string; ministry_id: string };
  return { isServant: row.is_servant, flowType: row.flow_type, label: row.label, ministryId: row.ministry_id };
}

export type CheckInPerson = { id: string; full_name: string; kind: "member" | "servant" | "pending" };

export async function listCheckInMembers(token: string): Promise<CheckInPerson[]> {
  const supabase = await createClient();
  const { data } = await supabase.rpc("checkin_list_members", { p_token: token });
  return ((data ?? []) as { member_id: string; full_name: string }[]).map((r) => ({
    id: r.member_id,
    full_name: r.full_name,
    kind: "member" as const,
  }));
}

/** Combined list of already-registered servants and not-yet-approved
 * pending self-registrations (0014_servant_self_registration.sql), so
 * someone who registered last week finds their own name instead of
 * submitting a duplicate. */
export async function listCheckInServants(token: string): Promise<CheckInPerson[]> {
  const supabase = await createClient();
  const { data } = await supabase.rpc("checkin_list_servants", { p_token: token });
  return ((data ?? []) as { id: string; full_name: string; kind: "servant" | "pending" }[]).map((r) => ({
    id: r.id,
    full_name: r.full_name,
    kind: r.kind,
  }));
}
