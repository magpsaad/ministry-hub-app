"use server";

import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import { logAudit } from "@/lib/audit";

/** Toggles a servant's Present/Absent status for one date -- same
 * presence-row model as member attendance (§6.5): "Present" is a row
 * existing, "Absent" is deleting it. */
export async function setServantAttendanceAction(servantId: string, date: string, present: boolean) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return { error: "Not signed in" };

  if (present) {
    // Already Present (e.g. checked in after the sheet was opened): fine,
    // not a "duplicate key" error (owner-reported, 9 Oct 2026).
    const { data, error } = await supabase
      .from("attendance_records")
      .upsert(
        { attendee_type: "servant", servant_id: servantId, service_date: date },
        { onConflict: "ministry_id,servant_id,service_date", ignoreDuplicates: true },
      )
      .select("id");
    if (error) return { error: error.message };
    if (data && data.length > 0) await logAudit(user.id, "ATTENDANCE_ADDED", { details: { servantId, date } });
  } else {
    const { error } = await supabase
      .from("attendance_records")
      .delete()
      .eq("servant_id", servantId)
      .eq("service_date", date);
    if (error) return { error: error.message };
    await logAudit(user.id, "ATTENDANCE_REMOVED", { details: { servantId, date } });
  }

  revalidatePath("/servants-attendance");
  return { error: null };
}
