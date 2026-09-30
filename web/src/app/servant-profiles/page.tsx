import Link from "next/link";
import { redirect } from "next/navigation";
import { getCurrentUser } from "@/lib/supabase/get-current-user";
import { getAccessSummary } from "@/lib/roles";
import { getAppSettings } from "@/lib/app-settings";
import { getServantDirectory } from "@/lib/servant-directory";
import { logAudit } from "@/lib/audit";
import { AppLogo } from "@/components/AppLogo";
import { MenuButton } from "@/components/MenuButton";
import { RefreshButton } from "@/components/RefreshButton";
import { SignOutButton } from "@/components/SignOutButton";
import { ServantProfilesInteractive } from "@/components/ServantProfilesInteractive";

/** REQUIREMENTS.md §6.1/§6.13 -- Coordinator Corner, General/Sub-Coordinators
 * and Admins. Profile viewing/editing only -- cohort assignment lives on the
 * separate Servant Assignments screen. */
export default async function ServantProfilesPage() {
  const user = await getCurrentUser();
  if (!user) redirect("/login");

  const access = await getAccessSummary(user.id);
  if (!access.isCoordinator && !access.isAdmin) {
    return (
      <div className="min-h-full flex items-center justify-center bg-[#f5f5f5] p-4">
        <p className="text-sm text-[#666]">You don&rsquo;t have access to this page.</p>
      </div>
    );
  }

  const [settings, servants] = await Promise.all([getAppSettings(), getServantDirectory()]);

  await logAudit(user.id, "SERVANT_PROFILES_VIEWED");

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
        <p className="mt-1 text-sm opacity-90">Servant Profiles</p>
      </header>
      <main className="max-w-4xl mx-auto px-4 py-6">
        <ServantProfilesInteractive servants={servants} canManageServants={access.isAdmin || access.isGeneralCoordinator} />
      </main>
    </div>
  );
}
