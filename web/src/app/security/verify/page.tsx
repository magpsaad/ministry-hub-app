import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { signOut } from "@/app/login/actions";
import { verifyAuthenticatorCode } from "../actions";
import { safeNext, CARD, PRIMARY_BUTTON, CODE_INPUT } from "../shared";
import { SecurityShell } from "../Shell";

/** The second sign-in step for someone with an authenticator app set up
 * (migration 0079: until it's done, the database treats Admin/GC/Church
 * Admin powers -- and, for anyone who turned it on, all access -- as off). */
export default async function VerifyAuthenticatorPage({
  searchParams,
}: {
  searchParams: Promise<{ next?: string; error?: string }>;
}) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect("/login");

  const { next: rawNext, error } = await searchParams;
  const next = safeNext(rawNext);

  const { data: level } = await supabase.auth.mfa.getAuthenticatorAssuranceLevel();
  if (level?.currentLevel === "aal2") redirect(next);
  if (level?.nextLevel !== "aal2") redirect(`/security/setup?next=${encodeURIComponent(next)}`);

  return (
    <SecurityShell title="Enter your authenticator code">
      <div className={CARD}>
        <p className="mb-4 text-sm text-[#555]">
          Open your authenticator app (Google or Microsoft Authenticator) and enter the 6-digit code shown for{" "}
          <strong>Ministry Hub</strong>.
        </p>
        {error && (
          <div className="mb-3 rounded-md bg-[#f8d7da] px-3 py-2 text-sm text-[#721c24]">
            That code didn&apos;t work. Codes change every 30 seconds &mdash; try the current one.
          </div>
        )}
        <form action={verifyAuthenticatorCode} className="space-y-3">
          <input type="hidden" name="next" value={next} />
          <input
            name="code"
            type="text"
            inputMode="numeric"
            autoComplete="one-time-code"
            pattern="[0-9 ]{6,7}"
            maxLength={7}
            required
            autoFocus
            aria-label="6-digit code"
            className={CODE_INPUT}
          />
          <button type="submit" className={PRIMARY_BUTTON}>
            Continue
          </button>
        </form>
        <p className="mt-4 text-xs text-[#777]">
          Lost or replaced your phone? Ask your ministry&apos;s Admin to reset your authenticator, then sign in again
          to set it up on the new phone.
        </p>
      </div>
      <form action={signOut} className="mt-4 text-center">
        <button type="submit" className="text-sm text-[#666] hover:underline">
          Sign out
        </button>
      </form>
    </SecurityShell>
  );
}
