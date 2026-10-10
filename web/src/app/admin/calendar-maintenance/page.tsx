import { redirect } from "next/navigation";
import { getCurrentUser } from "@/lib/supabase/get-current-user";
import { getAccessSummary } from "@/lib/roles";
import { getAppSettings } from "@/lib/app-settings";
import { todayInZone } from "@/lib/timezone";
import { AppLogo } from "@/components/AppLogo";
import { MenuButton } from "@/components/MenuButton";
import { BackButton } from "@/components/BackButton";
import { RefreshButton } from "@/components/RefreshButton";
import { CalendarMaintenanceInteractive } from "@/components/admin/CalendarMaintenanceInteractive";
import { getHolidayRulesAction, getDeletedEventsAction } from "@/app/admin/calendar-maintenance/actions";
import { DeletedEventsBin } from "@/components/admin/DeletedEventsBin";
import { HeaderWordmark } from "@/components/MinistryHubBrand";
import { HomeLink } from "@/components/HomeLink";

/** REQUIREMENTS.md §6.8/§6.1 -- Admin Corner, Admins only. */
export default async function CalendarMaintenancePage() {
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

  const [settings, initialRules, deletedEvents] = await Promise.all([
    getAppSettings(),
    getHolidayRulesAction(),
    getDeletedEventsAction(),
  ]);

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
        <p className="mt-1 text-sm opacity-90">Calendar Maintenance</p>
        <HeaderWordmark />
      </header>
      <main className="max-w-2xl mx-auto px-4 py-6 space-y-4">
        <CalendarMaintenanceInteractive defaultYear={Number(todayInZone(settings.timezone).slice(0, 4))} initialRules={initialRules} />
        <DeletedEventsBin initial={deletedEvents} />
      </main>
    </div>
  );
}
