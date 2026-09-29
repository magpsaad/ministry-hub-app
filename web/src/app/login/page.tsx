import Link from "next/link";
import { redirect } from "next/navigation";
import { getBranding } from "@/lib/branding";
import { createClient } from "@/lib/supabase/server";
import { AppLogo } from "@/components/AppLogo";
import { signInWithGoogle, signInWithPassword, signUpWithPassword, requestPasswordReset } from "./actions";

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
  const { error, message, mode } = await searchParams;
  const isSignUp = mode === "signup";
  const isForgot = mode === "forgot";

  return (
    <div className="min-h-full flex items-center justify-center bg-[#f5f5f5] px-4 py-12">
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

          {isForgot ? (
            <>
              <p className="mb-4 text-sm text-[#666]">
                Enter your email and we&apos;ll send you a link to reset your password.
              </p>
              <form action={requestPasswordReset} className="space-y-3">
                <div>
                  <label className="block text-sm font-semibold mb-1" htmlFor="email">
                    Email
                  </label>
                  <input
                    id="email"
                    name="email"
                    type="email"
                    required
                    className="w-full rounded-md border border-[#ddd] px-3 py-2.5 text-sm focus:border-brand focus:outline-none focus:ring-2 focus:ring-brand/10"
                  />
                </div>
                <button
                  type="submit"
                  className="w-full rounded-md bg-brand py-3 text-sm font-semibold text-white hover:bg-brand-dark shadow-[0_2px_4px_rgba(0,0,0,0.15)] transition-all hover:-translate-y-0.5 hover:shadow-[0_4px_8px_rgba(0,0,0,0.2)] active:translate-y-0 active:shadow-[0_1px_2px_rgba(0,0,0,0.15)]"
                >
                  Send reset link
                </button>
              </form>
              <p className="mt-4 text-center text-sm text-[#666]">
                <Link href="/login" className="font-semibold text-brand">
                  Back to sign in
                </Link>
              </p>
            </>
          ) : (
            <>
              <form action={signInWithGoogle}>
                <button
                  type="submit"
                  className="w-full flex items-center justify-center gap-2 rounded-md bg-brand py-3 text-sm font-semibold text-white hover:bg-brand-dark shadow-[0_2px_4px_rgba(0,0,0,0.15)] transition-all hover:-translate-y-0.5 hover:shadow-[0_4px_8px_rgba(0,0,0,0.2)] active:translate-y-0 active:shadow-[0_1px_2px_rgba(0,0,0,0.15)]"
                >
                  <GoogleIcon />
                  Continue with Google
                </button>
              </form>

              <div className="my-5 flex items-center gap-3 text-xs text-[#999]">
                <div className="h-px flex-1 bg-[#eee]" />
                or
                <div className="h-px flex-1 bg-[#eee]" />
              </div>

              <form action={isSignUp ? signUpWithPassword : signInWithPassword} className="space-y-3">
                {isSignUp && (
                  <div>
                    <label className="block text-sm font-semibold mb-1" htmlFor="full_name">
                      Full name
                    </label>
                    <input
                      id="full_name"
                      name="full_name"
                      type="text"
                      required
                      className="w-full rounded-md border border-[#ddd] px-3 py-2.5 text-sm focus:border-brand focus:outline-none focus:ring-2 focus:ring-brand/10"
                    />
                  </div>
                )}
                <div>
                  <label className="block text-sm font-semibold mb-1" htmlFor="email">
                    Email
                  </label>
                  <input
                    id="email"
                    name="email"
                    type="email"
                    required
                    className="w-full rounded-md border border-[#ddd] px-3 py-2.5 text-sm focus:border-brand focus:outline-none focus:ring-2 focus:ring-brand/10"
                  />
                </div>
                <div>
                  <div className="flex items-center justify-between mb-1">
                    <label className="block text-sm font-semibold" htmlFor="password">
                      Password
                    </label>
                    {!isSignUp && (
                      <Link href="/login?mode=forgot" className="text-xs font-semibold text-brand">
                        Forgot password?
                      </Link>
                    )}
                  </div>
                  <input
                    id="password"
                    name="password"
                    type="password"
                    required
                    minLength={6}
                    className="w-full rounded-md border border-[#ddd] px-3 py-2.5 text-sm focus:border-brand focus:outline-none focus:ring-2 focus:ring-brand/10"
                  />
                </div>
                <button
                  type="submit"
                  className="w-full rounded-md border border-brand bg-white py-3 text-sm font-semibold text-brand hover:bg-[#f0f4f8] shadow-[0_2px_4px_rgba(0,0,0,0.1)] transition-all hover:-translate-y-0.5 hover:shadow-[0_4px_8px_rgba(0,0,0,0.15)] active:translate-y-0 active:shadow-[0_1px_2px_rgba(0,0,0,0.1)]"
                >
                  {isSignUp ? "Create account" : "Sign in"}
                </button>
              </form>

              <p className="mt-4 text-center text-sm text-[#666]">
                {isSignUp ? (
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
