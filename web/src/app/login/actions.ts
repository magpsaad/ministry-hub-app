"use server";

import { cookies, headers } from "next/headers";
import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { CODE_EMAIL_COOKIE, CODE_EMAIL_SECONDS, type LoginErrorCode } from "./messages";

async function siteOrigin() {
  const h = await headers();
  const proto = h.get("x-forwarded-proto") ?? "http";
  const host = h.get("host");
  return `${proto}://${host}`;
}


const EMAIL_SHAPE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

function fail(code: LoginErrorCode, mode?: "signup" | "code"): never {
  redirect(`/login?${mode ? `mode=${mode}&` : ""}error=${code}`);
}

/** Cloudflare Turnstile's answer, added to the form by the widget (lib in
 * components/TurnstileWidget.tsx). Supabase checks it when CAPTCHA
 * protection is switched on in its Auth settings; until then it's ignored. */
function captchaToken(formData: FormData): string | undefined {
  const token = formData.get("cf-turnstile-response");
  return typeof token === "string" && token ? token : undefined;
}

export async function signInWithGoogle() {
  const supabase = await createClient();
  const origin = await siteOrigin();

  const { data, error } = await supabase.auth.signInWithOAuth({
    provider: "google",
    options: { redirectTo: `${origin}/auth/callback` },
  });

  if (error) fail("google_failed");
  redirect(data.url);
}

/** Owner-approved sign-in change A (3 Oct 2026): no more passwords -- anyone
 * not using Google gets a 6-digit code by email instead (Supabase's "Magic
 * Link" email, whose Ministry Hub template shows the code). `create` is the
 * "New here?" form: it may create the account, with the name they typed;
 * the plain sign-in form never creates one, so a typo can't make a stray
 * account. Either way the next screen is the same "check your email" step,
 * so this never reveals whether an address has an account. */
export async function requestEmailCode(formData: FormData) {
  const email = String(formData.get("email") ?? "").trim().toLowerCase();
  const create = formData.get("create") === "1";
  const fullName = String(formData.get("full_name") ?? "").trim().replace(/\s+/g, " ").slice(0, 120);
  const mode = create ? "signup" : undefined;

  if (!EMAIL_SHAPE.test(email) || email.length > 254) fail("invalid_email", mode);
  if (create && !fullName) fail("name_required", mode);

  const supabase = await createClient();
  const { error } = await supabase.auth.signInWithOtp({
    email,
    options: {
      shouldCreateUser: create,
      data: create ? { full_name: fullName } : undefined,
      captchaToken: captchaToken(formData),
    },
  });

  if (error) {
    const code = (error as { code?: string }).code ?? "";
    if (code === "over_email_send_rate_limit" || error.status === 429) {
      // Owner-reported (5 Oct 2026): a double tap sent two requests; the
      // second hit this limit and sent the person back to the email screen,
      // away from the code that had already arrived. Go to the code step.
      if (create) fail("rate", mode);
      await rememberCodeEmail(email);
      fail("already_sent", "code");
    }
    if (code === "captcha_failed") fail("captcha", mode);
    if (code === "email_address_invalid" || code === "validation_failed") fail("invalid_email", mode);
    // An address with no account on the sign-in form: carry on to the code
    // step exactly as if a code had gone out (no code will arrive).
    if (!(code === "otp_disabled" || code === "signup_disabled" || code === "user_not_found")) fail("send_failed", mode);
  }

  await rememberCodeEmail(email);
  redirect("/login?mode=code");
}

/** The address the code step is for (shown masked, never in the address bar). */
async function rememberCodeEmail(email: string) {
  (await cookies()).set(CODE_EMAIL_COOKIE, email, {
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "lax",
    path: "/",
    maxAge: CODE_EMAIL_SECONDS,
  });
}

/** "Send a new code" on the code step -- same as the first send, for the
 * address remembered in the cookie. Only ever signs in (never creates). */
export async function resendEmailCode(formData: FormData) {
  const email = (await cookies()).get(CODE_EMAIL_COOKIE)?.value;
  if (!email) fail("expired");

  const supabase = await createClient();
  const { error } = await supabase.auth.signInWithOtp({
    email,
    options: { shouldCreateUser: false, captchaToken: captchaToken(formData) },
  });
  if (error) {
    const code = (error as { code?: string }).code ?? "";
    if (code === "over_email_send_rate_limit" || error.status === 429) fail("already_sent", "code");
    if (code === "captcha_failed") fail("captcha", "code");
    if (!(code === "otp_disabled" || code === "signup_disabled" || code === "user_not_found")) fail("send_failed", "code");
  }
  redirect("/login?mode=code");
}

export async function verifyEmailCode(formData: FormData) {
  const jar = await cookies();
  const email = jar.get(CODE_EMAIL_COOKIE)?.value;
  if (!email) fail("expired");

  const token = String(formData.get("code") ?? "").replace(/\D/g, "");
  if (token.length < 6) fail("bad_code", "code");

  const supabase = await createClient();
  const { error } = await supabase.auth.verifyOtp({ email, token, type: "email" });
  if (error) fail("bad_code", "code");

  jar.delete(CODE_EMAIL_COOKIE);
  redirect("/");
}

/** The code step's "Use a different email". */
export async function startOver() {
  (await cookies()).delete(CODE_EMAIL_COOKIE);
  redirect("/login");
}

/** Signs out of THIS address only (QA E-5). Supabase's default ends every
 * session the person has -- every ministry's address, the console and every
 * other device -- which broke "each address keeps its own sign-in"
 * (MULTI_TENANT_PLAN.md §3.6). */
export async function signOut() {
  const supabase = await createClient();
  await supabase.auth.signOut({ scope: "local" });
  redirect("/login");
}

/** Owner-approved sign-in fix F: "Sign out of all devices" (Account
 * Security page) -- ends every session this person has, on every device,
 * every ministry's address and the console. For a lost or shared phone. */
export async function signOutEverywhere() {
  const supabase = await createClient();
  await supabase.auth.signOut({ scope: "global" });
  redirect("/login?message=signed_out_everywhere");
}
