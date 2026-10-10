import { redirect } from "next/navigation";
import { getCurrentUser } from "@/lib/supabase/get-current-user";
import { getAccessSummary } from "@/lib/roles";
import { getAppSettings } from "@/lib/app-settings";
import { getAllProfilesAction, getAllRoleRowsAction } from "@/app/admin/access-maintenance/actions";
import { getAccessibleGroups } from "@/lib/groups";
import { AppLogo } from "@/components/AppLogo";
import { MenuButton } from "@/components/MenuButton";
import { BackButton } from "@/components/BackButton";
import { RefreshButton } from "@/components/RefreshButton";
import { AccessMaintenanceInteractive } from "@/components/admin/AccessMaintenanceInteractive";
import { HeaderWordmark } from "@/components/MinistryHubBrand";
import { HomeLink } from "@/components/HomeLink";

/** REQUIREMENTS.md §6.14/§6.1/§4 -- Admin Corner, Admins only. */
export default async function AccessMaintenancePage() {
  const user = await getCurrentUser();
  if (!user) redirect("/login");

  const access = await getAccessSummary(user.id);
  if (!access.isAdmin) {
    return (
      <div className="min-h-full flex items-center justify-center bg-[#f5f5f5] p-4">
        <p className="text-sm text-[#666]">You don&rsquo;t have access to this page.</p>
      </div>
    );
  }

  const [settings, profiles, roles, groups] = await Promise.all([
    getAppSettings(),
    getAllProfilesAction(),
    getAllRoleRowsAction(),
    getAccessibleGroups(),
  ]);
  // Roles can only be given on regular groups (migration 0069 refuses the
  // hidden pre-entry and hand-over groups).
  const servingGroups = groups.filter((g) => g.kind === "regular");

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
        <p className="mt-1 text-sm opacity-90">Access Maintenance</p>
        <HeaderWordmark />
      </header>
      <main className="max-w-4xl mx-auto px-4 py-6">
        <AccessMaintenanceInteractive
          profiles={profiles}
          initialRoles={roles}
          groups={servingGroups}
          coordinatorScope={settings.coordinator_scope}
          ladderLabel={settings.ladder_position_label}
          levelOffset={settings.level_number_offset}
        />
      </main>
    </div>
  );
}
