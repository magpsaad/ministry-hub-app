"use server";

import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import { roleWords } from "@/lib/role-labels-server";

/** My Settings -> Calendar Sync (migration 0107): make my private link (or a
 * new one -- the old one stops working), or turn it off. */
export async function newCalendarFeedAction(): Promise<{ error: string | null }> {
  const supabase = await createClient();
  const { error } = await supabase.rpc("new_calendar_feed");
  if (error) return { error: await roleWords(error.message) };
  revalidatePath("/settings/calendar");
  return { error: null };
}

export async function deleteCalendarFeedAction(): Promise<{ error: string | null }> {
  const supabase = await createClient();
  const { error } = await supabase.rpc("delete_calendar_feed");
  if (error) return { error: await roleWords(error.message) };
  revalidatePath("/settings/calendar");
  return { error: null };
}
