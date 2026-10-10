import Link from "next/link";
import { redirect } from "next/navigation";
import { getCurrentUser } from "@/lib/supabase/get-current-user";
import { getAccessSummary } from "@/lib/roles";
import { getAppSettings, getAttendanceWindowSettings, weekdayName } from "@/lib/app-settings";
import { getServantAttendanceBundle } from "@/lib/servant-attendance";
import { logAudit } from "@/lib/audit";
import { AppLogo } from "@/components/AppLogo";
import { MenuButton } from "@/components/MenuButton";
import { BackButton } from "@/components/BackButton";
import { RefreshButton } from "@/components/RefreshButton";
import { ServantsAttendanceInteractive } from "@/components/ServantsAttendanceInteractive";
import { HeaderWordmark } from "@/components/MinistryHubBrand";
import { getRoleLabels } from "@/lib/role-labels-server";

/** REQUIREMENTS.md §6.1/§6.13 -- Coordinator Corner, General/Sub-Coordinators and Admins. */
export default async function ServantsAttendancePage() {
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

  const [settings, bundle, windowSettings, L] = await Promise.all([
    getAppSettings(),
    getServantAttendanceBundle(),
    getAttendanceWindowSettings(),
    getRoleLabels(),
  ]);
  await logAudit(user.id, "SERVANT_ATTENDANCE_VIEWED");

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
        <p className="mt-1 text-sm opacity-90">{L.servant} Attendance</p>
        <HeaderWordmark />
      </header>
      <main className="max-w-3xl mx-auto px-4 py-6">
        <ServantsAttendanceInteractive
          bundle={bundle}
          dayName={weekdayName(windowSettings.service_weekday)}
          groupLabel={settings.group_label}
        />
      </main>
    </div>
  );
}
