"use server";

import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import { safeNext } from "./shared";

/** Owner-approved sign-in change B (3 Oct 2026): an authenticator app as a
 * second sign-in step -- required for Admins, General Coordinators and the
 * Church Admin, optional "extra security" for everyone else. Migration 0079
 * makes the database honour it; these actions set it up and use it. */

const CODE = /^\d{6}$/;

function cleanCode(raw: unknown): string {
  return String(raw ?? "").replace(/\D/g, "");
}

/** Step 1 of setting it up: a fresh QR code. Any earlier, unfinished
 * attempt is cleared first (Supabase keeps those until removed). */
export async function startAuthenticatorSetup(): Promise<
  { error: string } | { factorId: string; qr: string; secret: string; uri: string }
> {
  const supabase = await createClient();
  const { data: list, error: listError } = await supabase.auth.mfa.listFactors();
  if (listError) return { error: "Please sign in again." };

  for (const f of list.all ?? []) {
    if (f.factor_type === "totp" && f.status !== "verified") {
      await supabase.auth.mfa.unenroll({ factorId: f.id });
    }
  }

  const { data, error } = await supabase.auth.mfa.enroll({
    factorType: "totp",
    friendlyName: `Authenticator ${new Date().toISOString().slice(0, 16)}`,
    issuer: "Ministry Hub",
  });
  if (error || !data) return { error: "Couldn't start the setup. Please try again." };
  return { factorId: data.id, qr: data.totp.qr_code, secret: data.totp.secret, uri: data.totp.uri };
}

/** Step 2: the first code from the app proves it's set up, and finishes
 * this sign-in's second step at the same time. */
export async function finishAuthenticatorSetup(factorId: string, rawCode: string): Promise<{ error: string | null }> {
  const code = cleanCode(rawCode);
  if (!CODE.test(code)) return { error: "Enter the 6-digit code from the app." };
  const supabase = await createClient();
  const { error } = await supabase.auth.mfa.challengeAndVerify({ factorId, code });
  if (error) return { error: "That code didn't work. Codes change every 30 seconds -- try the current one." };
  revalidatePath("/", "layout");
  return { error: null };
}

/** The second step at sign-in, for someone who already set it up. */
export async function verifyAuthenticatorCode(formData: FormData) {
  const next = safeNext(String(formData.get("next") ?? "/"));
  const code = cleanCode(formData.get("code"));
  const back = `/security/verify?error=1&next=${encodeURIComponent(next)}`;
  if (!CODE.test(code)) redirect(back);

  const supabase = await createClient();
  const { data: list } = await supabase.auth.mfa.listFactors();
  const factor = list?.totp?.find((f) => f.status === "verified");
  if (!factor) redirect("/security/setup");

  const { error } = await supabase.auth.mfa.challengeAndVerify({ factorId: factor.id, code });
  if (error) redirect(back);
  redirect(next);
}

/** Turning it off (optional users), or clearing it before setting up a new
 * phone. Supabase only allows this from a sign-in that passed the step.
 * Someone for whom it's required is simply asked to set it up again. */
export async function removeAuthenticator(factorId: string): Promise<{ error: string | null }> {
  const supabase = await createClient();
  const { error } = await supabase.auth.mfa.unenroll({ factorId });
  if (error) return { error: "Couldn't remove it. Please try again." };
  revalidatePath("/security");
  return { error: null };
}

/** Face ID / fingerprint unlock (migration 0089): remove one of my devices. */
export async function removeUnlockDevice(id: string): Promise<{ error: string | null }> {
  const supabase = await createClient();
  const { data, error } = await supabase.rpc("remove_unlock_device", { p_id: id });
  if (error || !data) return { error: "Couldn't remove it. Please try again." };
  revalidatePath("/security");
  return { error: null };
}
