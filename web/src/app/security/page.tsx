import Link from "next/link";
import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { signOutEverywhere } from "@/app/login/actions";
import { MinistryHubLogo, MinistryHubName } from "@/components/MinistryHubBrand";
import { MenuButton } from "@/components/MenuButton";
import { BackButton } from "@/components/BackButton";
import { RefreshButton } from "@/components/RefreshButton";
import { CARD, PRIMARY_BUTTON } from "./shared";
import { RemoveAuthenticatorButton } from "./RemoveAuthenticatorButton";
import { getBranding } from "@/lib/branding";
import { formatDateTimeInZone } from "@/lib/timezone";
import { firstGateRow } from "@/lib/agreement";
import { relyingParty } from "@/lib/screen-lock-server";
import { FaceIdCard, type UnlockDeviceRow } from "./FaceIdCard";
import { LinkSpinner, SubmitButton } from "@/components/PendingButton";

/** Account Security (owner-approved sign-in changes B and F, 3 Oct 2026):
 * the optional -- or, for Admins, General Coordinators and the Church
 * Admin, required -- authenticator app, the confidentiality agreement
 * (migration 0086), and "Sign out of all devices". */
export default async function AccountSecurityPage() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect("/login");

  const { rpID } = await relyingParty();
  const [{ data: factors }, { data: gate }, { data: agreementData }, { data: mySignature }, branding, { data: unlockDevices }, { data: lockState }] = await Promise.all([
    supabase.auth.mfa.listFactors(),
    supabase.rpc("gate_info"),
    supabase.rpc("agreement_gate"),
    supabase
      .from("agreement_signatures")
      .select("id, signed_at")
      .eq("user_id", user.id)
      .order("signed_at", { ascending: false })
      .limit(1)
      .maybeSingle(),
    getBranding(),
    supabase
      .from("unlock_devices")
      .select("id, label, created_at, last_used_at")
      .eq("rp_id", rpID)
      .order("created_at"),
    supabase.rpc("screen_lock_state", { p_touch: false }),
  ]);
  const lockMinutes = (lockState as { lock_minutes: number | null }[] | null)?.[0]?.lock_minutes ?? null;
  const required = Boolean((gate as { mfa_required: boolean }[] | null)?.[0]?.mfa_required);
  const authenticators = (factors?.totp ?? []).filter((f) => f.status === "verified");
  const agreement = firstGateRow(agreementData);
  const longDate = (iso: string) =>
    formatDateTimeInZone(iso, branding.timezone, { year: "numeric", month: "long", day: "numeric" });

  return (
    <div className="min-h-full bg-[#f5f5f5]">
      {/* Owner-requested (4 Oct 2026): the same header as Release History --
          Menu, Back and Refresh, under the app's own logo and name. (The
          setup, verify and agreement screens keep the plain SecurityShell:
          they show before sign-in is complete.) */}
      <header className="bg-gradient-to-br from-brand to-brand-light text-white px-5 py-5 text-center shadow-[0_2px_10px_rgba(0,0,0,0.1)] relative sticky top-[var(--qa-banner-h)] z-40">
        <div className="absolute top-2.5 left-4 flex flex-col items-start gap-1">
          <MenuButton />
          <BackButton />
        </div>
        <div className="absolute top-2.5 right-4">
          <RefreshButton />
        </div>
        <Link href="/" className="inline-flex items-center justify-center gap-2 hover:opacity-90 transition-opacity">
          <MinistryHubLogo size={38} onDark />
          <h1>
            <MinistryHubName light className="h-6" />
          </h1>
        </Link>
        <p className="mt-1 text-sm opacity-90">Account Security</p>
      </header>
      <main className="max-w-2xl mx-auto px-4 py-6 space-y-4">
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
                    {formatDateTimeInZone(f.created_at, branding.timezone, { year: "numeric", month: "short", day: "numeric" })}
                  </span>
                  <RemoveAuthenticatorButton factorId={f.id} required={required} />
                </li>
              ))}
            </ul>
          ) : (
            <Link href="/security/setup?next=/security" className={`${PRIMARY_BUTTON} mt-4 block text-center`}>
              {required ? "Set it up" : "Turn it on"}
              <LinkSpinner />
            </Link>
          )}
        </div>

        <FaceIdCard devices={(unlockDevices ?? []) as UnlockDeviceRow[]} lockMinutes={lockMinutes} />

        {agreement && (
          <div className={CARD}>
            <h2 className="text-base font-bold text-[#333]">Confidentiality Agreement</h2>
            <p className="mt-1 text-sm text-[#555]">
              {!agreement.needs_signature && mySignature
                ? `You signed it on ${longDate(mySignature.signed_at)}. You can read it again any time.`
                : agreement.grace_until && !agreement.must_sign
                  ? `Please read and sign it by ${longDate(agreement.grace_until)}.`
                  : "Please read and sign it."}
            </p>
            <Link href="/security/agreement?next=/security" className={`${PRIMARY_BUTTON} mt-4 block text-center`}>
              {agreement.needs_signature ? "Read and sign" : "Read the agreement"}
              <LinkSpinner />
            </Link>
          </div>
        )}

        <div className={CARD}>
          <h2 className="text-base font-bold text-[#333]">Sign out of all devices</h2>
          <p className="mt-1 text-sm text-[#555]">
            Lost a phone, or signed in on a shared computer? This signs you out everywhere &mdash; every device, every
            ministry&apos;s address and the console. You&apos;ll need to sign in again here too.
          </p>
          <form action={signOutEverywhere} className="mt-3">
            <SubmitButton
              className="w-full rounded-md border border-[#dc3545] bg-white py-2.5 text-sm font-semibold text-[#dc3545] hover:bg-[#fdf2f3]"
              busyText="Signing out everywhere…"
            >
              Sign out of all devices
            </SubmitButton>
          </form>
        </div>
      </main>
    </div>
  );
}
