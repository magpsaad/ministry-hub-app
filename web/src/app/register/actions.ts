"use server";

import { revalidatePath } from "next/cache";
import { after } from "next/server";
import { dispatchPush } from "@/lib/push";
import { createClient } from "@/lib/supabase/server";
import { logAudit } from "@/lib/audit";
import { validBirthday } from "@/lib/birthday";

export type RegistrationInput = {
  phone: string;
  gender: "Male" | "Female";
  father_of_confession: string | null;
  comments: string | null;
  /** Optional, day and month only (owner-approved 15 Oct 2026, 0116). */
  birthday_month: number | null;
  birthday_day: number | null;
};

/** Their own birthday straight onto their own profile (they can always
 * edit their own row); skipped when left blank. */
async function saveOwnBirthday(supabase: Awaited<ReturnType<typeof createClient>>, userId: string, input: RegistrationInput) {
  if (input.birthday_month === null || input.birthday_day === null) return null;
  const { error } = await supabase
    .from("profiles")
    .update({ birthday_month: input.birthday_month, birthday_day: input.birthday_day })
    .eq("id", userId);
  return error?.message ?? null;
}

/** REQUIREMENTS.md §6.1 addendum -- for someone with NO role yet: submits
 * (or updates, if they already submitted once) a pending_servants row via
 * submit_own_servant_registration() (migration 0039), tied directly to
 * their real profile id -- no email-matching risk for this path. Still
 * requires the normal Admin/GC approval before granting anything; this
 * never grants access by itself (owner-agreed, closes the "sign in then
 * self-register unnoticed" loophole). */
export async function submitOwnRegistrationAction(input: RegistrationInput) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return { error: "Not signed in" };
  if (!validBirthday(input.birthday_month, input.birthday_day)) return { error: "Choose both a month and a day for your birthday." };

  const { error } = await supabase.rpc("submit_own_servant_registration", {
    p_phone: input.phone,
    p_gender: input.gender,
    p_father_of_confession: input.father_of_confession,
    p_comments: input.comments,
  });
  if (error) return { error: error.message };
  const birthdayError = await saveOwnBirthday(supabase, user.id, input);
  if (birthdayError) return { error: birthdayError };

  await logAudit(user.id, "APP_ACCESS", { details: { action: "self_registration_submitted" } });
  // Migration 0092: the new pending servant queued an alert for this
  // ministry's Admins and GCs; send it once this answer is on its way.
  after(dispatchPush);
  revalidatePath("/register");
  return { error: null };
}

/** For someone who ALREADY holds a role (granted directly, bypassing
 * Checkin) but is missing the mandatory fields -- a human already decided
 * to grant their access, so this just fills in their own profile directly,
 * no separate approval cycle (owner-agreed). RLS already allows updating
 * one's own profile row (profiles_update: id = auth.uid()). */
export async function completeOwnProfileAction(input: RegistrationInput) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return { error: "Not signed in" };
  if (!validBirthday(input.birthday_month, input.birthday_day)) return { error: "Choose both a month and a day for your birthday." };

  const { error } = await supabase
    .from("profiles")
    .update({
      phone: input.phone,
      gender: input.gender,
      father_of_confession: input.father_of_confession,
    })
    .eq("id", user.id);
  if (error) return { error: error.message };
  const birthdayError = await saveOwnBirthday(supabase, user.id, input);
  if (birthdayError) return { error: birthdayError };

  await logAudit(user.id, "SERVANT_EDITED", { details: { action: "self_registration_completed" } });
  revalidatePath("/register");
  return { error: null };
}
