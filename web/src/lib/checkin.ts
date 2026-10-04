import { createCheckinClient } from "@/lib/supabase/checkin-client";

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
/** null = not a check-in code; "switched_off" = a pre-entry or hand-over
 * code whose "QR code active" switch is off (GROUP_LADDER_PLAN.md D5). */
export async function getCheckInFlow(token: string): Promise<CheckInFlow | "switched_off" | null> {
  const supabase = await createCheckinClient();
  const { data, error } = await supabase.rpc("checkin_get_flow", { p_token: token }).single();
  if (error?.message.includes("isn't active")) return "switched_off";
  if (error || !data) return null;
  const row = data as { is_servant: boolean; flow_type: CheckInFlow["flowType"]; label: string; ministry_id: string };
  return { isServant: row.is_servant, flowType: row.flow_type, label: row.label, ministryId: row.ministry_id };
}

/** `full_name` is the SHORT name the database gives out (migration 0074):
 * first name + last initial ("Mina H."), or the full last name when two
 * results would look the same. The public page never receives full names. */
export type CheckInPerson = { id: string; full_name: string; kind: "member" | "servant" | "pending" };

/** Migration 0074 -- whether names can be searched and attendance taken
 * right now (the service day, between the ministry's check-in times), and
 * the times to show when it's closed. */
export type CheckInWindow = { isOpen: boolean; serviceWeekday: number; opensAt: string; closesAt: string };

export async function getCheckInWindow(token: string): Promise<CheckInWindow | null> {
  const supabase = await createCheckinClient();
  const { data } = await supabase.rpc("checkin_window", { p_token: token }).maybeSingle();
  if (!data) return null;
  const row = data as { is_open: boolean; service_weekday: number; opens_at: string; closes_at: string };
  return { isOpen: row.is_open, serviceWeekday: row.service_weekday, opensAt: row.opens_at, closesAt: row.closes_at };
}

/** The person this device remembers (by the id in its "Remember me" cookie),
 * as a short name -- null when check-in is closed or they're not on this
 * code's list. */
export async function getRememberedCheckInPerson(
  token: string,
  isServant: boolean,
  remembered: { id: string; kind: CheckInPerson["kind"] },
): Promise<CheckInPerson | null> {
  const supabase = await createCheckinClient();
  const { data } = isServant
    ? await supabase.rpc("checkin_get_servant", { p_token: token, p_id: remembered.id, p_kind: remembered.kind })
    : await supabase.rpc("checkin_get_member", { p_token: token, p_member_id: remembered.id });
  return typeof data === "string" && data ? { id: remembered.id, full_name: data, kind: remembered.kind } : null;
}
