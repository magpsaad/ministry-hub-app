import Link from "next/link";
import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { signOutEverywhere } from "@/app/login/actions";
import { SecurityShell } from "./Shell";
import { CARD, PRIMARY_BUTTON } from "./shared";
import { RemoveAuthenticatorButton } from "./RemoveAuthenticatorButton";

/** Account Security (owner-approved sign-in changes B and F, 3 Oct 2026):
 * the optional -- or, for Admins, General Coordinators and the Church
 * Admin, required -- authenticator app, and "Sign out of all devices". */
export default async function AccountSecurityPage() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect("/login");

  const [{ data: factors }, { data: gate }] = await Promise.all([
    supabase.auth.mfa.listFactors(),
    supabase.rpc("gate_info"),
  ]);
  const required = Boolean((gate as { mfa_required: boolean }[] | null)?.[0]?.mfa_required);
  const authenticators = (factors?.totp ?? []).filter((f) => f.status === "verified");

  return (
    <SecurityShell title="Account Security">
      <div className="space-y-4">
        <div className={CARD}>
          <h2 className="text-base font-bold text-[#333]">Authenticator app</h2>
          <p className="mt-1 text-sm text-[#555]">
            {required
              ? "Required for your role: when you sign in on a new device, you also enter a code from your phone."
              : "Optional extra security: when you sign in on a new device, you also enter a code from your phone, so nobody can get in with your email alone."}
          </p>

          {authenticators.length > 0 ? (
            <ul className="mt-3 divide-y divide-[#f0f0f0]">
              {authenticators.map((f) => (
                <li key={f.id} className="flex items-center justify-between py-2 text-sm">
                  <span className="text-[#333]">
                    <span className="mr-2 rounded bg-[#d4edda] px-1.5 py-0.5 text-[11px] font-semibold uppercase text-[#155724]">
                      On
                    </span>
                    Added{" "}
                    {new Date(f.created_at).toLocaleDateString(undefined, { year: "numeric", month: "short", day: "numeric" })}
                  </span>
                  <RemoveAuthenticatorButton factorId={f.id} required={required} />
                </li>
              ))}
            </ul>
          ) : (
            <Link href="/security/setup?next=/security" className={`${PRIMARY_BUTTON} mt-4 block text-center`}>
              {required ? "Set it up" : "Turn it on"}
            </Link>
          )}
        </div>

        <div className={CARD}>
          <h2 className="text-base font-bold text-[#333]">Sign out of all devices</h2>
          <p className="mt-1 text-sm text-[#555]">
            Lost a phone, or signed in on a shared computer? This signs you out everywhere &mdash; every device, every
            ministry&apos;s address and the console. You&apos;ll need to sign in again here too.
          </p>
          <form action={signOutEverywhere} className="mt-3">
            <button
              type="submit"
              className="w-full rounded-md border border-[#dc3545] bg-white py-2.5 text-sm font-semibold text-[#dc3545] hover:bg-[#fdf2f3]"
            >
              Sign out of all devices
            </button>
          </form>
        </div>

        <p className="text-center text-sm">
          <Link href="/" className="font-semibold text-brand hover:underline">
            &larr; Back to the app
          </Link>
        </p>
      </div>
    </SecurityShell>
  );
}
