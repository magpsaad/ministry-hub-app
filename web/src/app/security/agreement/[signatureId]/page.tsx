import Link from "next/link";
import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { getBranding } from "@/lib/branding";
import { getRoleLabels } from "@/lib/role-labels-server";
import { formatDateTimeInZone } from "@/lib/timezone";
import { SecurityShell } from "../../Shell";
import { CARD } from "../../shared";
import { AgreementText } from "../AgreementText";
import { PrintButton } from "../Buttons";

/** A signed copy: exactly the wording that was signed, with the typed name,
 * email and time (migration 0086). Who can open it is decided by the
 * database: the signer, an Admin or General Coordinator of a ministry the
 * signer belongs to, or the Church Admin. */
export default async function SignedAgreementPage({ params }: { params: Promise<{ signatureId: string }> }) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect("/login");

  const { signatureId } = await params;
  const id = Number(signatureId);
  const [{ data: sig }, branding, L] = await Promise.all([
    Number.isInteger(id)
      ? supabase
          .from("agreement_signatures")
          .select("id, user_id, typed_name, email, signed_at, version:agreement_versions(version, title, body)")
          .eq("id", id)
          .maybeSingle()
      : Promise.resolve({ data: null }),
    getBranding(),
    getRoleLabels(),
  ]);
  const version = sig?.version as unknown as { version: number; title: string; body: string } | null;

  if (!sig || !version) {
    return (
      <SecurityShell title="Signed agreement">
        <div className={CARD}>
          <p className="text-sm text-[#555]">This signed copy doesn&apos;t exist or you can&apos;t open it.</p>
        </div>
        <p className="mt-4 text-center text-sm">
          <Link href="/security" className="font-semibold text-brand hover:underline">
            &larr; Account Security
          </Link>
        </p>
      </SecurityShell>
    );
  }

  const own = sig.user_id === user.id;
  const signedAt = formatDateTimeInZone(sig.signed_at, branding.timezone, {
    year: "numeric",
    month: "long",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
    timeZoneName: "short",
  });

  return (
    <SecurityShell title={version.title} wide>
      <div className="space-y-4">
        <div className={`${CARD} print:p-0 print:shadow-none`}>
          <AgreementText body={version.body} />
          <div className="mt-6 rounded-lg border border-[#ddd] p-4 text-sm text-[#333]">
            <p className="font-bold">Signed electronically in Ministry Hub</p>
            <dl className="mt-2 grid grid-cols-[auto_1fr] gap-x-4 gap-y-1">
              <dt className="text-[#666]">Signature (typed name)</dt>
              <dd className="font-semibold">{sig.typed_name}</dd>
              <dt className="text-[#666]">Email</dt>
              <dd>{sig.email ?? "—"}</dd>
              <dt className="text-[#666]">Date and time</dt>
              <dd>{signedAt}</dd>
              <dt className="text-[#666]">Agreement version</dt>
              <dd>{version.version}</dd>
            </dl>
          </div>
        </div>
        <div className="flex flex-wrap items-center justify-between gap-3 print:hidden">
          <Link href={own ? "/security/agreement" : "/servant-profiles"} className="text-sm font-semibold text-brand hover:underline">
            &larr; {own ? "Back to the agreement" : `${L.servant} Profiles`}
          </Link>
          <PrintButton />
        </div>
      </div>
    </SecurityShell>
  );
}
