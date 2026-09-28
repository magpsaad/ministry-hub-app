import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { updatePasswordAction } from "./actions";

/** Landing point for the "forgot password" email link, reached via
 * /auth/callback exchanging the link's code for a real (recovery-type)
 * session first -- by the time this page renders, the visitor is already
 * signed in under that session, which is what lets updateUser({ password })
 * work without asking for their old one. No session here means the link
 * was already used, expired, or opened without going through the exchange
 * -- sent back to request a fresh one rather than shown a broken form. */
export default async function ResetPasswordPage({
  searchParams,
}: {
  searchParams: Promise<{ error?: string }>;
}) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) {
    redirect(`/login?mode=forgot&error=${encodeURIComponent("This reset link is invalid or has expired. Please request a new one.")}`);
  }

  const { error } = await searchParams;

  return (
    <div className="min-h-full flex items-center justify-center bg-[#f5f5f5] px-4 py-12">
      <div className="w-full max-w-sm">
        <div className="bg-white rounded-xl shadow-[0_4px_20px_rgba(0,0,0,0.06)] p-6">
          <h1 className="text-lg font-bold text-brand mb-1">Set a new password</h1>
          <p className="mb-4 text-sm text-[#666]">Signed in as {user.email}.</p>

          {error && (
            <div className="mb-4 rounded-md bg-[#f8d7da] text-[#721c24] text-sm px-3 py-2">{error}</div>
          )}

          <form action={updatePasswordAction} className="space-y-3">
            <div>
              <label className="block text-sm font-semibold mb-1" htmlFor="password">
                New password
              </label>
              <input
                id="password"
                name="password"
                type="password"
                required
                minLength={6}
                className="w-full rounded-md border border-[#ddd] px-3 py-2.5 text-sm focus:border-brand focus:outline-none focus:ring-2 focus:ring-brand/10"
              />
            </div>
            <div>
              <label className="block text-sm font-semibold mb-1" htmlFor="confirm_password">
                Confirm password
              </label>
              <input
                id="confirm_password"
                name="confirm_password"
                type="password"
                required
                minLength={6}
                className="w-full rounded-md border border-[#ddd] px-3 py-2.5 text-sm focus:border-brand focus:outline-none focus:ring-2 focus:ring-brand/10"
              />
            </div>
            <button
              type="submit"
              className="w-full rounded-md bg-brand py-3 text-sm font-semibold text-white hover:bg-brand-dark shadow-[0_2px_4px_rgba(0,0,0,0.15)] transition-all hover:-translate-y-0.5 hover:shadow-[0_4px_8px_rgba(0,0,0,0.2)] active:translate-y-0 active:shadow-[0_1px_2px_rgba(0,0,0,0.15)]"
            >
              Update password
            </button>
          </form>
        </div>
      </div>
    </div>
  );
}
