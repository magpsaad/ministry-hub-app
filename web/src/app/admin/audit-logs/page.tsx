import Link from "next/link";
import { redirect } from "next/navigation";
import { getCurrentUser } from "@/lib/supabase/get-current-user";
import { getAccessSummary } from "@/lib/roles";
import { getAppSettings } from "@/lib/app-settings";
import { getAuditLogsAction, getAuditConfigAction, getAuditLogUsersAction } from "@/app/admin/audit-logs/actions";
import { AppLogo } from "@/components/AppLogo";
import { MenuButton } from "@/components/MenuButton";
import { BackButton } from "@/components/BackButton";
import { RefreshButton } from "@/components/RefreshButton";
import { AuditLogsInteractive } from "@/components/admin/AuditLogsInteractive";
import { HeaderWordmark } from "@/components/MinistryHubBrand";

/** REQUIREMENTS.md §6.14/§6.1/§3.11 -- Admin Corner, Admins only. */
export default async function AuditLogsPage({ searchParams }: { searchParams: Promise<{ action?: string }> }) {
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

  // Opened from the Dashboard's check-in alert (?action=CHECKIN_REGISTRATION):
  // start on that action. Only a known action type is used.
  const { action } = await searchParams;
  const config = await getAuditConfigAction();
  const initialActionType = action && config.some((c) => c.action_type === action) ? action : "";
  const [settings, logs, users] = await Promise.all([
    getAppSettings(),
    getAuditLogsAction(initialActionType ? { actionType: initialActionType } : {}),
    getAuditLogUsersAction(),
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
        <Link href="/" className="inline-flex items-center justify-center gap-2 hover:opacity-90 transition-opacity">
          <AppLogo logoUrl={settings.logo_url} title={settings.app_title_short} size={32} circular={false} />
          <h1 className="text-2xl font-bold">{settings.app_title_short}</h1>
        </Link>
        <p className="mt-1 text-sm opacity-90">Audit Logs</p>
        <HeaderWordmark />
      </header>
      <main className="max-w-4xl mx-auto px-4 py-6">
        <AuditLogsInteractive
          initialLogs={logs}
          actionTypes={config.map((c) => c.action_type)}
          users={users}
          initialConfig={config}
          initialActionType={initialActionType}
        />
      </main>
    </div>
  );
}
