import Link from "next/link";
import { redirect } from "next/navigation";
import { getCurrentUser } from "@/lib/supabase/get-current-user";
import { getAppSettings } from "@/lib/app-settings";
import { getReleases } from "@/lib/releases";
import { AppLogo } from "@/components/AppLogo";
import { MenuButton } from "@/components/MenuButton";
import { BackButton } from "@/components/BackButton";
import { RefreshButton } from "@/components/RefreshButton";
import { VersionControlInteractive } from "@/components/VersionControlInteractive";

/** Owner-requested: Servant Corner, viewable by every app user. Read-only
 * in every ministry -- release notes are church-wide and are added/edited
 * only by the Church Admin, in the console (MULTI_TENANT_PLAN.md P9). */
export default async function VersionControlPage() {
  const user = await getCurrentUser();
  if (!user) redirect("/login");

  const [settings, releases] = await Promise.all([getAppSettings(), getReleases()]);

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
          <AppLogo logoUrl={settings.logo_url} title={settings.app_title_short} size={32} circular={false} />
          <h1 className="text-2xl font-bold">{settings.app_title_short}</h1>
        </Link>
        <p className="mt-1 text-sm opacity-90">Release History</p>
      </header>
      <main className="max-w-2xl mx-auto px-4 py-6">
        {/* Keyed on the data so Refresh (or any re-render with newer
            releases) shows the new list -- the component otherwise keeps
            the list it first received (QA O-3). */}
        <VersionControlInteractive
          key={releases.map((r) => `${r.id}:${r.version}:${r.released_on}:${r.description ?? ""}`).join("|")}
          initial={releases}
          canManage={false}
        />
      </main>
    </div>
  );
}
