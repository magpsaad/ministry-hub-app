import Link from "next/link";
import { redirect } from "next/navigation";
import { getCurrentUser } from "@/lib/supabase/get-current-user";
import { ensureProfile } from "@/lib/supabase/ensure-profile";
import { getAppSettings } from "@/lib/app-settings";
import { getRoleLabels } from "@/lib/role-labels-server";
import { createClient } from "@/lib/supabase/server";
import { AppLogo } from "@/components/AppLogo";
import { SignOutButton } from "@/components/SignOutButton";
import { RegisterInteractive } from "@/components/RegisterInteractive";
import { HeaderWordmark } from "@/components/MinistryHubBrand";
import { NotificationsSetupPanel } from "@/components/notifications/NotificationsSetupPanel";
import { vapidPublicKey } from "@/lib/push";

/** REQUIREMENTS.md §6.1 addendum -- the "exceptional workflow" landing
 * screen: where the proxy gate (src/proxy.ts) sends anyone signed in
 * without a complete registration. ensureProfile() runs here unconditionally
 * (same call the normal landing page makes), so this page is also the
 * guaranteed place link_approved_pending_servant() gets a chance to run for
 * someone who was just approved -- they don't have to find their way back
 * to "/" first. Three states, in order: fully cleared (shouldn't be here at
 * all -- send them home), awaiting Admin/GC approval (nothing to do but
 * wait), or the registration form itself. */
export default async function RegisterPage() {
  const user = await getCurrentUser();
  if (!user) redirect("/login");

  await ensureProfile(user);

  const supabase = await createClient();

  // Owner-reported: if an Admin grants access directly through Access
  // Maintenance instead of formally approving this person's /register
  // submission through Pending Servants, the phone/gender they already
  // typed once never gets copied over (link_approved_pending_servant()
  // only fires for a formally approved row) -- they'd land back here and
  // be asked to retype the same two fields. absorb_own_pending_
  // registration() (migration 0042) is a no-op unless they already hold a
  // role AND still have an unlinked submission of their own sitting
  // around, so it's safe to call unconditionally on every load.
  await supabase.rpc("absorb_own_pending_registration");

  const [{ data: profile }, { data: roles }, { data: pending }, settings, L] = await Promise.all([
    supabase.from("profiles").select("full_name, phone, gender").eq("id", user.id).maybeSingle(),
    supabase.from("user_roles").select("role").eq("user_id", user.id),
    supabase
      .from("pending_servants")
      .select("id")
      .eq("submitted_by_profile_id", user.id)
      .is("resulting_profile_id", null)
      .maybeSingle(),
    getAppSettings(),
    getRoleLabels(),
  ]);

  const hasRole = (roles?.length ?? 0) > 0;
  const isComplete = hasRole && !!profile?.phone && !!profile?.gender;
  if (isComplete) redirect("/");

  const awaitingApproval = !hasRole && !!pending;
  const fullName = profile?.full_name ?? user.email ?? "there";

  return (
    <div className="min-h-full flex flex-col bg-[#f5f5f5]">
      <header className="bg-gradient-to-br from-brand to-brand-light text-white px-5 py-6 text-center shadow-[0_2px_10px_rgba(0,0,0,0.1)] relative sticky top-[var(--qa-banner-h)] z-40">
        <div className="flex justify-center">
          <AppLogo logoUrl={settings.logo_url} title={settings.app_title_short} size={60} />
        </div>
        <h1 className="mt-3 text-[22px] font-bold">{settings.app_title_long}</h1>
        <div className="absolute top-2.5 right-4">
          <SignOutButton className="text-white/70 hover:text-white transition-colors" />
        </div>
        <HeaderWordmark corner="bottom" />
      </header>
      <main className="flex-1 max-w-md w-full mx-auto px-4 py-6 space-y-4">
        {awaitingApproval ? (
          <div className="rounded-xl bg-white shadow-[0_4px_20px_rgba(0,0,0,0.06)] p-5 text-center space-y-2">
            <h2 className="text-base font-bold text-brand">Awaiting approval</h2>
            <p className="text-sm text-[#666]">
              Thanks, {fullName} — your registration is in and waiting for a {L.coordinator} or System Admin to review it.
              There&rsquo;s nothing else to do right now; check back once they&rsquo;ve approved it.
            </p>
            {/* Owner-requested (6 Oct 2026): notifications while they wait. */}
            <div className="border-t border-[#eee] pt-4 mt-3">
              <NotificationsSetupPanel publicKey={vapidPublicKey()} waitingForApproval />
            </div>
          </div>
        ) : (
          <RegisterInteractive hasRole={hasRole} fullName={fullName} publicKey={vapidPublicKey()} />
        )}
        <p className="text-center text-xs text-[#999]">
          Signed in as {user.email}. Wrong account?{" "}
          <Link href="/login" className="underline">
            Sign in with a different one
          </Link>
          .
        </p>
      </main>
    </div>
  );
}
