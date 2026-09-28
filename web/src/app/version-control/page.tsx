import Link from "next/link";
import { redirect } from "next/navigation";
import { getCurrentUser } from "@/lib/supabase/get-current-user";
import { getAccessSummary } from "@/lib/roles";
import { getAppSettings } from "@/lib/app-settings";
import { getReleasesAction } from "@/app/version-control/actions";
import { AppLogo } from "@/components/AppLogo";
import { HomeLink } from "@/components/HomeLink";
import { RefreshButton } from "@/components/RefreshButton";
import { SignOutButton } from "@/components/SignOutButton";
import { VersionControlInteractive } from "@/components/VersionControlInteractive";

/** Owner-requested: Servant Corner, viewable by every app user -- adding a
 * release and editing existing ones stays System Admin only, enforced
 * both here (canManage passed down) and by app_releases' own write RLS
 * (is_admin(), migration 0055), so this is defense-in-depth, not the
 * only gate. */
export default async function VersionControlPage() {
  const user = await getCurrentUser();
  if (!user) redirect("/login");

  const access = await getAccessSummary(user.id);
  const [settings, releases] = await Promise.all([getAppSettings(), getReleasesAction()]);

  return (
    <div className="min-h-full bg-[#f5f5f5]">
      <header className="bg-gradient-to-br from-brand to-brand-light text-white px-5 py-5 text-center shadow-[0_2px_10px_rgba(0,0,0,0.1)] relative sticky top-[var(--qa-banner-h)] z-40">
        <div className="absolute top-2.5 left-4 flex flex-col items-start gap-1">
          <HomeLink />
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
        <p className="mt-1 text-sm opacity-90">Release History</p>
      </header>
      <main className="max-w-2xl mx-auto px-4 py-6">
        <VersionControlInteractive initial={releases} canManage={access.isAdmin} />
      </main>
    </div>
  );
}
