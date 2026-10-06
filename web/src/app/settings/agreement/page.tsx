import Link from "next/link";
import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { MinistryHubLogo, MinistryHubName } from "@/components/MinistryHubBrand";
import { MenuButton } from "@/components/MenuButton";
import { BackButton } from "@/components/BackButton";
import { RefreshButton } from "@/components/RefreshButton";
import { LinkSpinner } from "@/components/PendingButton";
import { CARD, PRIMARY_BUTTON } from "@/app/security/shared";
import { getBranding } from "@/lib/branding";
import { formatDateTimeInZone } from "@/lib/timezone";
import { AGREEMENT_PATH, firstGateRow } from "@/lib/agreement";

/** My Settings -> Confidentiality Agreement (owner-requested 6 Oct 2026;
 * moved here from Account Security -- it isn't a security feature): whether
 * I've signed (and when), and the way to read or sign it. The agreement
 * itself, and signing it during onboarding, stay at /security/agreement. */
export default async function AgreementSettingsPage() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect("/login");

  const [{ data: agreementData }, { data: mySignature }, branding] = await Promise.all([
    supabase.rpc("agreement_gate"),
    supabase
      .from("agreement_signatures")
      .select("id, signed_at")
      .eq("user_id", user.id)
      .order("signed_at", { ascending: false })
      .limit(1)
      .maybeSingle(),
    getBranding(),
  ]);
  const agreement = firstGateRow(agreementData);
  const longDate = (iso: string) =>
    formatDateTimeInZone(iso, branding.timezone, { year: "numeric", month: "long", day: "numeric" });

  return (
    <div className="min-h-full bg-[#f5f5f5]">
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
        <p className="mt-1 text-sm opacity-90">Confidentiality Agreement</p>
      </header>
      <main className="max-w-2xl mx-auto px-4 py-6 space-y-4">
        <div className={CARD}>
          <h2 className="text-base font-bold text-[#333]">Confidentiality Agreement</h2>
          {agreement ? (
            <>
              <p className="mt-1 text-sm text-[#555]">
                {!agreement.needs_signature && mySignature
                  ? `You signed it on ${longDate(mySignature.signed_at)}. You can read it again any time.`
                  : agreement.grace_until && !agreement.must_sign
                    ? `Please read and sign it by ${longDate(agreement.grace_until)}.`
                    : "Please read and sign it."}
              </p>
              <Link
                href={`${AGREEMENT_PATH}?next=/settings/agreement`}
                className={`${PRIMARY_BUTTON} mt-4 block text-center`}
              >
                {agreement.needs_signature ? "Read and sign" : "Read the agreement"}
                <LinkSpinner />
              </Link>
            </>
          ) : (
            <p className="mt-1 text-sm text-[#555]">There&rsquo;s no agreement to sign in this ministry.</p>
          )}
        </div>
      </main>
    </div>
  );
}
