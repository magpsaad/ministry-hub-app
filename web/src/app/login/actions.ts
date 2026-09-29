"use server";

import { headers } from "next/headers";
import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";

async function siteOrigin() {
  const h = await headers();
  const proto = h.get("x-forwarded-proto") ?? "http";
  const host = h.get("host");
  return `${proto}://${host}`;
}

export async function signInWithGoogle() {
  const supabase = await createClient();
  const origin = await siteOrigin();

  const { data, error } = await supabase.auth.signInWithOAuth({
    provider: "google",
    options: { redirectTo: `${origin}/auth/callback` },
  });

  if (error) {
    redirect(`/login?error=${encodeURIComponent(error.message)}`);
  }
  redirect(data.url);
}

export async function signInWithPassword(formData: FormData) {
  const email = String(formData.get("email") ?? "");
  const password = String(formData.get("password") ?? "");
  const supabase = await createClient();

  const { error } = await supabase.auth.signInWithPassword({ email, password });
  if (error) {
    redirect(`/login?error=${encodeURIComponent(error.message)}`);
  }
  redirect("/");
}

export async function signUpWithPassword(formData: FormData) {
  const email = String(formData.get("email") ?? "");
  const password = String(formData.get("password") ?? "");
  const fullName = String(formData.get("full_name") ?? "");
  const supabase = await createClient();
  const origin = await siteOrigin();

  const { error } = await supabase.auth.signUp({
    email,
    password,
    options: {
      emailRedirectTo: `${origin}/auth/callback`,
      data: { full_name: fullName },
    },
  });
  if (error) {
    redirect(`/login?error=${encodeURIComponent(error.message)}`);
  }
  redirect("/login?message=Check your email to confirm your account.");
}

/** "Forgot password" flow, step 1 of 2 -- emails a recovery link that lands
 * on /auth/callback (the same PKCE code-exchange route Google sign-in
 * already uses) with `next=/auth/reset-password`, so the code exchange
 * establishes a real (recovery-type) session before the new-password page
 * ever loads. Deliberately shows the same message whether or not the email
 * has an account -- matches Supabase Auth's own behavior of not erroring on
 * an unknown email (avoids confirming/denying which addresses are real). */
export async function requestPasswordReset(formData: FormData) {
  const email = String(formData.get("email") ?? "");
  const supabase = await createClient();
  const origin = await siteOrigin();

  const { error } = await supabase.auth.resetPasswordForEmail(email, {
    redirectTo: `${origin}/auth/callback?next=/auth/reset-password`,
  });
  if (error) {
    redirect(`/login?mode=forgot&error=${encodeURIComponent(error.message)}`);
  }
  redirect(`/login?message=${encodeURIComponent("If that email has an account, a password reset link is on its way.")}`);
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
