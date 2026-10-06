"use server";

import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";

/** Face ID / fingerprint unlock (migration 0089): remove one of my devices. */
export async function removeUnlockDevice(id: string): Promise<{ error: string | null }> {
  const supabase = await createClient();
  const { data, error } = await supabase.rpc("remove_unlock_device", { p_id: id });
  if (error || !data) return { error: "Couldn't remove it. Please try again." };
  revalidatePath("/settings/screen-lock");
  return { error: null };
}
