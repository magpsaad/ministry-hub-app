import Link from "next/link";
import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { signOut } from "@/app/login/actions";
import { safeNext } from "../shared";
import { SecurityShell } from "../Shell";
import { SetupInteractive } from "./SetupInteractive";

/** Setting up the authenticator app (owner-approved sign-in change B). The
 * front door (lib/supabase/proxy.ts) sends Admins, General Coordinators and
 * the Church Admin here until they've done it; anyone else can choose it
 * from Account Security. */
export default async function SetupAuthenticatorPage({
  searchParams,
}: {
  searchParams: Promise<{ next?: string }>;
}) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect("/login");

  const { next: rawNext } = await searchParams;
  const next = safeNext(rawNext);

  // Someone who already has it set up proves it first (Supabase requires
  // that before another phone can be added).
  const { data: level } = await supabase.auth.mfa.getAuthenticatorAssuranceLevel();
  if (level?.nextLevel === "aal2" && level.currentLevel !== "aal2") {
    redirect(`/security/verify?next=${encodeURIComponent("/security")}`);
  }

  const { data: gate } = await supabase.rpc("gate_info");
  const required = Boolean((gate as { mfa_required: boolean }[] | null)?.[0]?.mfa_required);

  return (
    <SecurityShell title="Set up your authenticator app">
      <SetupInteractive required={required} next={next} />
      <div className="mt-4 text-center text-sm">
        {required ? (
          <form action={signOut}>
            <button type="submit" className="text-[#666] hover:underline">
              Not now &mdash; sign out
            </button>
          </form>
        ) : (
          <Link href="/security" className="text-[#666] hover:underline">
            Cancel
          </Link>
        )}
      </div>
    </SecurityShell>
  );
}
