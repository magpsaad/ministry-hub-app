import Link from "next/link";
import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { getBranding } from "@/lib/branding";
import { createClient } from "@/lib/supabase/server";
import { AppLogo } from "@/components/AppLogo";
import { ClearMenuCache } from "@/components/ClearMenuCache";
import { MinistryHubLogo, MinistryHubName } from "@/components/MinistryHubBrand";
import { TurnstileWidget } from "@/components/TurnstileWidget";
import { SubmitButton } from "@/components/PendingButton";
import { signInWithGoogle, requestEmailCode, resendEmailCode, verifyEmailCode, startOver } from "./actions";
import { CODE_EMAIL_COOKIE, loginError, loginMessage, maskEmail } from "./messages";

const INPUT =
  "w-full rounded-md border border-[#ddd] px-3 py-2.5 text-sm focus:border-brand focus:outline-none focus:ring-2 focus:ring-brand/10";
const PRIMARY =
  "w-full rounded-md bg-brand py-3 text-sm font-semibold text-white hover:bg-brand-dark shadow-[0_2px_4px_rgba(0,0,0,0.15)] transition-all hover:-translate-y-0.5 hover:shadow-[0_4px_8px_rgba(0,0,0,0.2)] active:translate-y-0 active:shadow-[0_1px_2px_rgba(0,0,0,0.15)]";
const SECONDARY =
  "w-full rounded-md border border-brand bg-white py-3 text-sm font-semibold text-brand hover:bg-[#f0f4f8] shadow-[0_2px_4px_rgba(0,0,0,0.1)] transition-all hover:-translate-y-0.5 hover:shadow-[0_4px_8px_rgba(0,0,0,0.15)] active:translate-y-0 active:shadow-[0_1px_2px_rgba(0,0,0,0.1)]";

/** Owner-approved sign-in change A (3 Oct 2026): "Continue with Google" or
 * an emailed 6-digit code -- no passwords. Three steps on one page:
 * sign in (email), "New here?" (name + email), and the code step. Messages
 * come only from fixed codes (./messages.ts), never from the address. */
export default async function LoginPage({
  searchParams,
}: {
  searchParams: Promise<{ error?: string; message?: string; mode?: string }>;
}) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (user) redirect("/");

  const settings = await getBranding();
  const { error: errorCode, message: messageCode, mode } = await searchParams;
  const error = loginError(errorCode);
  const message = loginMessage(messageCode);
  const codeEmail = (await cookies()).get(CODE_EMAIL_COOKIE)?.value ?? null;
  const step = mode === "code" && codeEmail ? "code" : mode === "signup" ? "signup" : "signin";

  return (
    <div className="min-h-full flex items-center justify-center bg-[#f5f5f5] px-4 py-12">
      <ClearMenuCache />
      <div className="w-full max-w-sm">
        <div className="flex flex-col items-center mb-6">
          <AppLogo logoUrl={settings.logo_url} title={settings.app_title_short} size={60} />
          <h1 className="mt-4 text-2xl font-bold text-brand text-center">
            {settings.app_title_long}
          </h1>
          <p className="mt-1 text-sm text-[#666] text-center">{settings.app_subtitle}</p>
        </div>

        <div className="bg-white rounded-xl shadow-[0_4px_20px_rgba(0,0,0,0.06)] p-6">
          {error && (
            <div className="mb-4 rounded-md bg-[#f8d7da] text-[#721c24] text-sm px-3 py-2">
              {error}
            </div>
          )}
          {message && (
            <div className="mb-4 rounded-md bg-[#d4edda] text-[#155724] text-sm px-3 py-2">
              {message}
            </div>
          )}

          {step === "code" ? (
            <>
              <h2 className="text-base font-bold text-[#333]">Check your email</h2>
              <p className="mt-1 mb-4 text-sm text-[#666]">
                If <strong className="text-[#333]">{maskEmail(codeEmail!)}</strong> has an account, we&apos;ve sent
                it a 6-digit code from Ministry Hub. It can take a minute &mdash; check your spam folder too.
              </p>
              <form action={verifyEmailCode} className="space-y-3">
                <div>
                  <label className="block text-sm font-semibold mb-1" htmlFor="code">
                    Code
                  </label>
                  <input
                    id="code"
                    name="code"
                    type="text"
                    inputMode="numeric"
                    autoComplete="one-time-code"
                    pattern="[0-9 ]{6,8}"
                    maxLength={8}
                    required
                    autoFocus
                    className={`${INPUT} text-center text-lg tracking-[0.4em]`}
                  />
                </div>
                <SubmitButton className={PRIMARY} busyText="Signing in…">
                  Sign in
                </SubmitButton>
              </form>
              <form action={resendEmailCode} className="mt-4 space-y-2">
                <TurnstileWidget />
                <SubmitButton className="w-full text-sm font-semibold text-brand hover:underline" busyText="Sending…">
                  Send a new code
                </SubmitButton>
              </form>
              <form action={startOver} className="mt-1">
                <SubmitButton className="w-full text-sm text-[#666] hover:underline">Use a different email</SubmitButton>
              </form>
            </>
          ) : (
            <>
              <form action={signInWithGoogle}>
                <SubmitButton className={`${PRIMARY} flex items-center justify-center gap-2`} busyText="Opening Google…">
                  <GoogleIcon />
                  Continue with Google
                </SubmitButton>
              </form>

              <div className="my-5 flex items-center gap-3 text-xs text-[#999]">
                <div className="h-px flex-1 bg-[#eee]" />
                or
                <div className="h-px flex-1 bg-[#eee]" />
              </div>

              <form action={requestEmailCode} className="space-y-3">
                {step === "signup" && (
                  <>
                    <input type="hidden" name="create" value="1" />
                    <div>
                      <label className="block text-sm font-semibold mb-1" htmlFor="full_name">
                        Full name
                      </label>
                      <input id="full_name" name="full_name" type="text" required maxLength={120} className={INPUT} />
                    </div>
                  </>
                )}
                <div>
                  <label className="block text-sm font-semibold mb-1" htmlFor="email">
                    Email
                  </label>
                  <input id="email" name="email" type="email" required autoComplete="email" className={INPUT} />
                </div>
                <TurnstileWidget />
                <SubmitButton className={SECONDARY} busyText="Sending your code…">
                  {step === "signup" ? "Create account — email me a code" : "Email me a sign-in code"}
                </SubmitButton>
              </form>

              <p className="mt-4 text-center text-sm text-[#666]">
                {step === "signup" ? (
                  <>
                    Already have an account?{" "}
                    <Link href="/login" className="font-semibold text-brand">
                      Sign in
                    </Link>
                  </>
                ) : (
                  <>
                    New here?{" "}
                    <Link href="/login?mode=signup" className="font-semibold text-brand">
                      Create an account
                    </Link>
                  </>
                )}
              </p>
            </>
          )}
        </div>

        {/* Owner-requested (3 Oct 2026): the app's own emblem and name,
            under the sign-in box; the ministry's logo stays at the top. */}
        <div className="mt-6 flex items-center justify-center gap-2.5">
          <MinistryHubLogo size={44} />
          <MinistryHubName className="h-6" />
        </div>
      </div>
    </div>
  );
}

/** Google's official white/monochrome "G" mark -- their own brand kit's
 * variant for a colored (non-white) button background, since the standard
 * 4-color mark is designed for a white/light button and reads oddly on a
 * solid fill. */
function GoogleIcon() {
  return (
    <svg width="18" height="18" viewBox="0 0 18 18" aria-hidden="true">
      <path
        fill="white"
        d="M17.64 9.2c0-.64-.06-1.25-.16-1.84H9v3.48h4.84a4.14 4.14 0 0 1-1.8 2.72v2.26h2.9c1.7-1.57 2.7-3.88 2.7-6.62Z"
      />
      <path fill="white" d="M9 18c2.43 0 4.47-.8 5.96-2.18l-2.9-2.26c-.8.54-1.83.86-3.06.86-2.35 0-4.34-1.59-5.05-3.72H.9v2.33A9 9 0 0 0 9 18Z" />
      <path fill="white" d="M3.95 10.7A5.4 5.4 0 0 1 3.67 9c0-.59.1-1.17.28-1.7V4.97H.9A9 9 0 0 0 0 9c0 1.45.35 2.83.9 4.03l3.05-2.33Z" />
      <path fill="white" d="M9 3.58c1.32 0 2.51.46 3.44 1.35l2.58-2.58C13.46.89 11.43 0 9 0A9 9 0 0 0 .9 4.97L3.95 7.3C4.66 5.17 6.65 3.58 9 3.58Z" />
    </svg>
  );
}
