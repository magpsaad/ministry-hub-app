"use server";

import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";

/** An Admin marks a check-in sign-up alert (migration 0080) as reviewed;
 * the database refuses anyone else. */
export async function reviewCheckinAlertAction(id: string): Promise<{ error: string | null }> {
  const supabase = await createClient();
  const { error } = await supabase.rpc("review_checkin_alert", { p_id: id });
  if (error) return { error: error.message };
  revalidatePath("/", "layout");
  return { error: null };
}
