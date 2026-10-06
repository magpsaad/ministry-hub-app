"use server";

import { revalidatePath } from "next/cache";
import { after } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { dispatchPush } from "@/lib/push";

/** Marks a self-registered servant approved -- the account itself is created
 * automatically the first time that real person signs into the app (see
 * ensure-profile.ts / link_approved_pending_servant), not here. */
export async function approvePendingServantAction(id: string) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  const { error } = await supabase
    .from("pending_servants")
    .update({ approved_at: new Date().toISOString(), approved_by: user?.id ?? null })
    .eq("id", id);
  if (error) return { error: error.message };

  // "You're approved" to their phone, if they turned notifications on (0093).
  after(dispatchPush);
  revalidatePath("/admin/pending-servants");
  return { error: null };
}

/** Removes a pending registration that never got followed up on (e.g. a
 * one-off visitor who registered by mistake, or someone who never ended up
 * signing into the app). Cascades to their pending_servant_attendance rows. */
export async function removePendingServantAction(id: string) {
  const supabase = await createClient();
  const { error } = await supabase.from("pending_servants").delete().eq("id", id);
  if (error) return { error: error.message };

  revalidatePath("/admin/pending-servants");
  return { error: null };
}
