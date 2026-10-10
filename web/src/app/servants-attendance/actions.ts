"use server";

import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import { logAudit } from "@/lib/audit";

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
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return { error: "Not signed in" };

  if (present) {
    // Already Present (e.g. checked in after the sheet was opened): fine,
    // not a "duplicate key" error (owner-reported, 9 Oct 2026).
    // Insert, not upsert: the one-row rules are partial indexes (0111).
    const { error } = await supabase
      .from("attendance_records")
      .insert({ attendee_type: "servant", servant_id: servantId, service_date: date, event_id: eventId });
    if (error && error.code !== "23505") return { error: error.message };
    if (!error)
      await logAudit(user.id, "ATTENDANCE_ADDED", { details: { servantId, date, ...(eventId ? { eventId } : {}) } });
  } else {
    let q = supabase.from("attendance_records").delete().eq("servant_id", servantId);
    q = eventId ? q.eq("event_id", eventId) : q.eq("service_date", date).is("event_id", null);
    const { data, error } = await q.select("id");
    if (error) return { error: error.message };
    if (data && data.length > 0)
      await logAudit(user.id, "ATTENDANCE_REMOVED", { details: { servantId, date, ...(eventId ? { eventId } : {}) } });
  }

  revalidatePath("/servants-attendance");
  return { error: null };
}
