"use server";

import { getMember, type MemberDetail } from "@/lib/members";
import { createClient } from "@/lib/supabase/server";

/** Fetches one member's full detail on demand, when a card is clicked --
 * avoids pulling every field for every member in the list view. */
export async function getMemberAction(memberId: string): Promise<MemberDetail | null> {
  return getMember(memberId);
}

/** Every date this member has an attendance record for -- fetched on demand
 * when their average-attendance-% is clicked on the Member List, rather than
 * shipping every member's dates with the whole list. RLS scopes it to
 * members the caller can see. */
export async function getMemberPresentDatesAction(memberId: string): Promise<string[]> {
  const supabase = await createClient();
  const { data } = await supabase
    .from("attendance_records")
    .select("service_date")
    .eq("attendee_type", "member")
    .is("event_id", null) // service days only (event attendance, 0111)
    .eq("member_id", memberId);
  return (data ?? []).map((r) => r.service_date as string);
}
