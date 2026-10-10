"use server";

import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import { logAudit } from "@/lib/audit";

/** Toggles a member's Present/Absent status for one date -- no status
 * column, so "Present" is a row existing, "Absent" is deleting it.
 * Owner-reported (9 Oct 2026, HSY launch): a youth who checked in with the
 * QR code after the sheet was opened still showed Absent there, and tapping
 * Present then failed with a raw "duplicate key" error. Marking someone
 * Present who already is (or Absent who already is) now just succeeds.
 * eventId (owner-approved 10 Oct 2026, migration 0111): attendance at an
 * event/trip/outing that day instead of the service. */
export async function setAttendanceAction(
  memberId: string,
  groupId: string,
  date: string,
  present: boolean,
  eventId: string | null = null,
) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  const NO_PERMISSION = "You don't have permission to change attendance for this group.";

  if (present) {
    // The one-row-per-day/per-event rules are partial indexes (0111), which
    // an upsert can't name -- so insert, and an "already there" is fine.
    const { error } = await supabase
      .from("attendance_records")
      .insert({ attendee_type: "member", member_id: memberId, service_date: date, event_id: eventId });
    if (error && error.code !== "23505")
      return { error: /row-level security/i.test(error.message) ? NO_PERMISSION : error.message };
    // Only log a record actually added (not one that was already there).
    if (user && !error)
      await logAudit(user.id, "ATTENDANCE_ADDED", { groupId, details: { memberId, date, ...(eventId ? { eventId } : {}) } });
  } else {
    // Owner-reported (QA R-1): a delete the security rules refuse isn't an
    // error -- it just deletes nothing -- so this used to report success and
    // the screen showed "Absent" while nothing had changed. Count the rows.
    let del = supabase.from("attendance_records").delete().eq("member_id", memberId);
    del = eventId ? del.eq("event_id", eventId) : del.eq("service_date", date).is("event_id", null);
    const { data, error } = await del.select("id");
    if (error) return { error: error.message };
    if (!data || data.length === 0) {
      // Nothing deleted: already Absent (fine), or not allowed to delete it.
      let still = supabase.from("attendance_records").select("id", { count: "exact", head: true }).eq("member_id", memberId);
      still = eventId ? still.eq("event_id", eventId) : still.eq("service_date", date).is("event_id", null);
      const { count } = await still;
      if ((count ?? 0) > 0) return { error: NO_PERMISSION };
    } else if (user) {
      await logAudit(user.id, "ATTENDANCE_REMOVED", { groupId, details: { memberId, date, ...(eventId ? { eventId } : {}) } });
    }
  }

  revalidatePath(`/g/${groupId}/attendance`);
  revalidatePath(`/g/${groupId}/dashboard`);
  return { error: null };
}
