import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { AppLogo } from "@/components/AppLogo";
import { HeaderWordmark } from "@/components/MinistryHubBrand";
import { MenuButton } from "@/components/MenuButton";
import { BackButton } from "@/components/BackButton";
import { RefreshButton } from "@/components/RefreshButton";
import { HomeLink } from "@/components/HomeLink";
import { getAppSettings } from "@/lib/app-settings";
import { getAccessSummary } from "@/lib/roles";
import { getRoleLabels } from "@/lib/role-labels-server";
import { getAddressContext } from "@/lib/ministry-context";
import { DASHBOARD_PANELS, dashboardPanelNames } from "@/lib/dashboard-prefs";
import { getDashboardStartOpen } from "@/lib/dashboard-prefs-server";
import { DashboardPanelsCard } from "./DashboardPanelsCard";

/** My Settings -> Dashboard (owner-requested 15 Oct 2026, migration 0116):
 * which Dashboard panels start expanded and which start collapsed, panel by
 * panel (owner's wording: "expand", never "open"). The Overview is always
 * expanded; My Servants Team is only listed
 * for those who have it. */
export default async function DashboardSettingsPage() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect("/login");
  const address = await getAddressContext();
  if (address.kind !== "ministry") redirect("/security");

  const [settings, access, L, startOpen] = await Promise.all([
    getAppSettings(),
    getAccessSummary(user.id),
    getRoleLabels(),
    getDashboardStartOpen(),
  ]);
  const names = dashboardPanelNames(settings.member_label, L.servants);
  const hasTeam = access.isGeneralCoordinator || access.isAdmin || access.isSubCoordinator;
  const panels = DASHBOARD_PANELS.filter((p) => p !== "servant_team" || hasTeam).map((p) => ({
    panel: p,
    name: names[p],
    startOpen: startOpen[p],
  }));

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
        <HomeLink className="inline-flex items-center justify-center gap-2 hover:opacity-90 transition-opacity">
          <AppLogo logoUrl={settings.logo_url} title={settings.app_title_short} size={32} circular={false} />
          <h1 className="text-2xl font-bold">{settings.app_title_short}</h1>
        </HomeLink>
        <p className="mt-1 text-sm opacity-90">Dashboard</p>
        <HeaderWordmark />
      </header>
      <main className="max-w-2xl mx-auto px-4 py-6 space-y-4">
        <DashboardPanelsCard panels={panels} overviewName={`${settings.member_label} Overview`} />
      </main>
    </div>
  );
}
