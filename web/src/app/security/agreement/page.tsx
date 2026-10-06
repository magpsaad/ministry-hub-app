import Link from "next/link";
import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { getBranding } from "@/lib/branding";
import { formatDateTimeInZone } from "@/lib/timezone";
import { firstGateRow } from "@/lib/agreement";
import { signOut } from "@/app/login/actions";
import { SecurityShell } from "../Shell";
import { CARD, safeNext } from "../shared";
import { AgreementText } from "./AgreementText";
import { SignButton } from "./Buttons";
import { SubmitButton } from "@/components/PendingButton";
import { signAgreement, remindLater } from "./actions";

const ERRORS: Record<string, string> = {
  agree: "Tick the box to confirm you agree.",
  name: "Type your full name to sign.",
  updated: "The agreement has just been updated. Please read the new version below.",
  failed: "Couldn't save your signature. Please try again.",
};

/** The Servant Confidentiality & Privacy Agreement (migration 0086): read
 * it, sign it, or -- once signed -- read it again any time. The front door
 * (src/lib/supabase/proxy.ts) sends people here until they've signed. */
export default async function AgreementPage({
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

  const [{ data: gateData }, { data: version }, { data: mine }, { data: profile }, branding] = await Promise.all([
    supabase.rpc("agreement_gate"),
    supabase
      .from("agreement_versions")
      .select("id, version, title, body")
      .order("published_at", { ascending: false })
      .order("version", { ascending: false })
      .limit(1)
      .maybeSingle(),
    supabase
      .from("agreement_signatures")
      .select("id, typed_name, signed_at, signed_version:agreement_versions(version)")
      .eq("user_id", user.id)
      .order("signed_at", { ascending: false })
      .limit(1)
      .maybeSingle(),
    supabase.from("profiles").select("full_name").eq("id", user.id).maybeSingle(),
    getBranding(),
  ]);
  const gate = firstGateRow(gateData);
  // Migration 0088: a small addition can keep earlier signatures valid, so
  // someone may have signed an older version than the one shown below.
  const signedVersion = (mine?.signed_version as unknown as { version: number } | null)?.version ?? null;
  const when = (iso: string, withTime = false) =>
    formatDateTimeInZone(iso, branding.timezone, {
      year: "numeric",
      month: "long",
      day: "numeric",
      ...(withTime ? { hour: "numeric", minute: "2-digit" } : {}),
    });

  if (!version || !gate) {
    return (
      <SecurityShell title="Confidentiality Agreement">
        <div className={CARD}>
          <p className="text-sm text-[#555]">There is no agreement to sign yet.</p>
        </div>
        <BackLink />
      </SecurityShell>
    );
  }

  const graceOpen = gate.needs_signature && !gate.must_sign && gate.grace_until;

  return (
    <SecurityShell title={version.title} wide>
      <div className="space-y-4">
        {gate.needs_signature ? (
          <div className="rounded-xl border border-[#ffe08a] bg-[#fff8e1] px-4 py-3 text-sm text-[#5c4400]">
            {graceOpen
              ? `Please read and sign this agreement by ${when(gate.grace_until!)}. After that date, you'll need to sign it before you can use the app.`
              : mine
                ? "This agreement needs to be signed again. Please read it and sign below to continue using the app."
                : "Please read and sign this agreement to continue using the app."}
          </div>
        ) : (
          mine && (
            <div className="rounded-xl border border-[#c3e6cb] bg-[#eaf7ee] px-4 py-3 text-sm text-[#155724]">
              {signedVersion !== null && signedVersion !== version.version ? (
                <>
                  You signed version {signedVersion} of this agreement on {when(mine.signed_at, true)} as{" "}
                  <strong>{mine.typed_name}</strong>, and it still counts. The current wording, version {version.version},
                  is shown below.{" "}
                </>
              ) : (
                <>
                  You signed this agreement on {when(mine.signed_at, true)} as <strong>{mine.typed_name}</strong>.{" "}
                </>
              )}
              <Link href={`/security/agreement/${mine.id}`} className="font-semibold underline">
                View or print your signed copy
              </Link>
            </div>
          )
        )}

        <div className={CARD}>
          <AgreementText body={version.body} />
          <p className="mt-4 text-xs text-[#777]">Version {version.version}</p>
        </div>

        {gate.needs_signature && (
          <div className={CARD}>
            <h2 className="text-base font-bold text-[#333]">Sign</h2>
            {error && ERRORS[error] && (
              <div className="mt-2 rounded-md bg-[#f8d7da] px-3 py-2 text-sm text-[#721c24]">{ERRORS[error]}</div>
            )}
            <form action={signAgreement} className="mt-3 space-y-3">
              <input type="hidden" name="next" value={next} />
              <input type="hidden" name="version_id" value={version.id} />
              <label className="flex items-start gap-2 text-sm text-[#333]">
                <input type="checkbox" name="agree" required className="mt-0.5 h-4 w-4 accent-[var(--brand)]" />
                <span>I have read this agreement, I understand it, and I agree to follow it.</span>
              </label>
              <div>
                <label htmlFor="typed_name" className="mb-1 block text-sm font-semibold text-[#333]">
                  Type your full name as your signature
                </label>
                <input
                  id="typed_name"
                  name="typed_name"
                  type="text"
                  required
                  minLength={2}
                  maxLength={120}
                  autoComplete="name"
                  placeholder={profile?.full_name ?? "Full name"}
                  className="w-full rounded-md border border-[#ddd] px-3 py-2.5 text-sm focus:border-brand focus:outline-none focus:ring-2 focus:ring-brand/10"
                />
                <p className="mt-1 text-xs text-[#777]">
                  The app records your name, your email ({user.email}) and the date and time you sign.
                </p>
              </div>
              <SignButton />
            </form>
            {graceOpen ? (
              <form action={remindLater} className="mt-3">
                <input type="hidden" name="next" value={next} />
                <SubmitButton className="w-full rounded-md border border-[#ddd] bg-white py-2.5 text-sm font-semibold text-[#333] hover:bg-[#f5f5f5]">
                  Remind me later
                </SubmitButton>
              </form>
            ) : (
              <form action={signOut} className="mt-3 text-center">
                <SubmitButton className="text-sm font-semibold text-[#666] hover:underline" busyText="Signing out…">
                  Sign out
                </SubmitButton>
              </form>
            )}
          </div>
        )}

        {!gate.needs_signature && <BackLink />}
      </div>
    </SecurityShell>
  );
}

function BackLink() {
  return (
    <p className="mt-4 text-center text-sm">
      <Link href="/security" className="font-semibold text-brand hover:underline">
        &larr; Account Security
      </Link>
    </p>
  );
}
