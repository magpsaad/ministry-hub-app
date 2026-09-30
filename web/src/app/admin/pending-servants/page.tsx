import Link from "next/link";
import { redirect } from "next/navigation";
import { getCurrentUser } from "@/lib/supabase/get-current-user";
import { getAccessSummary } from "@/lib/roles";
import { getAppSettings } from "@/lib/app-settings";
import { getPendingServants } from "@/lib/pending-servants";
import { AppLogo } from "@/components/AppLogo";
import { MenuButton } from "@/components/MenuButton";
import { RefreshButton } from "@/components/RefreshButton";
import { SignOutButton } from "@/components/SignOutButton";
import { PendingServantRow } from "@/components/admin/PendingServantRow";

/** Minimal Admin/General Coordinator screen to review servants who self-
 * registered via the "Servants" QR code (0014_servant_self_registration.sql)
 * -- a functional first pass, to be folded into the fuller Admin screens
 * design in Phase F. */
export default async function PendingServantsPage() {
  const user = await getCurrentUser();
  if (!user) redirect("/login");

  const access = await getAccessSummary(user.id);
  if (!access.isAdmin && !access.isGeneralCoordinator) {
    return (
      <div className="min-h-full flex items-center justify-center bg-[#f5f5f5] p-4">
        <p className="text-sm text-[#666]">You don&rsquo;t have access to this page.</p>
      </div>
    );
  }

  const [pending, settings] = await Promise.all([getPendingServants(), getAppSettings()]);

  return (
    <div className="min-h-full bg-[#f5f5f5]">
      <header className="bg-gradient-to-br from-brand to-brand-light text-white px-5 py-5 text-center shadow-[0_2px_10px_rgba(0,0,0,0.1)] relative sticky top-[var(--qa-banner-h)] z-40">
        <div className="absolute top-2.5 left-4 flex flex-col items-start gap-1">
          <MenuButton />
          <RefreshButton />
        </div>
        <div className="absolute top-2.5 right-4 flex flex-col items-end gap-1">
          <SignOutButton className="text-white/70 hover:text-white transition-colors" />
          <span className="text-[10px] text-white/60">Version {settings.app_version}</span>
        </div>
        <Link href="/" className="inline-flex items-center justify-center gap-2 hover:opacity-90 transition-opacity">
          <AppLogo logoUrl={settings.logo_url} title={settings.app_title_short} size={32} circular={false} />
          <h1 className="text-2xl font-bold">{settings.app_title_short}</h1>
        </Link>
        <p className="mt-1 text-sm opacity-90">Pending Servants</p>
      </header>
      <main className="max-w-2xl mx-auto px-4 py-6 space-y-3">
        {pending.length === 0 ? (
          <p className="text-sm text-[#666] text-center">No pending servant registrations right now.</p>
        ) : (
          pending.map((s) => <PendingServantRow key={s.id} servant={s} />)
        )}
      </main>
    </div>
  );
}
