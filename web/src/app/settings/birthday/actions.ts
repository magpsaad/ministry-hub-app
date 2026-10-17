"use server";

import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import { validBirthday } from "@/lib/birthday";

/** My Settings -> My Birthday and the Dashboard's one-time card (owner-
 * approved 15 Oct 2026, migration 0116): day and month only, no year.
 * Both empty clears it. */
export async function saveMyBirthdayAction(month: number | null, day: number | null) {
  if (!validBirthday(month, day)) return { error: "Choose both a month and a day." };
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return { error: "Not signed in" };

  const { error } = await supabase
    .from("profiles")
    .update({ birthday_month: month, birthday_day: day })
    .eq("id", user.id);
  if (error) return { error: error.message };

  revalidatePath("/", "layout");
  return { error: null };
}

/** "Not now" (asks again in 30 days) or "No thanks" (never asks again). */
export async function snoozeBirthdayPromptAction(never: boolean) {
  const supabase = await createClient();
  const { error } = await supabase.rpc("snooze_birthday_prompt", { p_days: never ? null : 30 });
  if (error) return { error: error.message };
  return { error: null };
}
