"use server";

import { createClient } from "@/lib/supabase/server";

/** Toggles a servant's Present/Absent status for one date -- same
 * presence-row model as member attendance (§6.5): "Present" is a row
 * existing, "Absent" is deleting it. */
export async function setServantAttendanceAction(
  servantId: string,
  date: string,
  present: boolean,
  eventId: string | null = null,
) {
  const supabase = await createClient();

  if (present) {
    // Already Present (e.g. checked in after the sheet was opened): fine,
    // not a "duplicate key" error (owner-reported, 9 Oct 2026).
    // Insert, not upsert: the one-row rules are partial indexes (0111).
    const { error } = await supabase
      .from("attendance_records")
      .insert({ attendee_type: "servant", servant_id: servantId, service_date: date, event_id: eventId });
    if (error && error.code !== "23505") return { error: error.message };
  } else {
    let q = supabase.from("attendance_records").delete().eq("servant_id", servantId);
    q = eventId ? q.eq("event_id", eventId) : q.eq("service_date", date).is("event_id", null);
    const { error } = await q;
    if (error) return { error: error.message };
  }

  // The sheet already shows the change; revalidating it rebuilt the whole
  // sheet on the server after every tap (owner-requested, 11 Oct 2026).
  return { error: null };
}
