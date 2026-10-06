import Link from "next/link";
import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { AppLogo } from "@/components/AppLogo";
import { HeaderWordmark } from "@/components/MinistryHubBrand";
import { getAppSettings } from "@/lib/app-settings";
import { MenuButton } from "@/components/MenuButton";
import { BackButton } from "@/components/BackButton";
import { RefreshButton } from "@/components/RefreshButton";
import { vapidPublicKey } from "@/lib/push";
import { getAddressContext } from "@/lib/ministry-context";
import { NotificationsCard } from "./NotificationsCard";
import { NotificationTypesCard, type NotificationTypeRow } from "./NotificationTypesCard";

/** My Settings -> Notifications (owner-requested 6 Oct 2026, migration
 * 0094): this person's own choices, as opposed to Ministry Settings. This
 * device on or off (moved here from Account Security), then which kinds of
 * notification they want -- only the kinds that can ever reach their role
 * in this ministry. Branded as the ministry (owner-requested 6 Oct 2026):
 * everything on it belongs to this ministry's address. */
export default async function NotificationSettingsPage() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect("/login");
  const address = await getAddressContext();
  if (address.kind !== "ministry") redirect("/security");

  const [{ data: pushRows }, { data: types }, settings] = await Promise.all([
    supabase.from("push_subscriptions").select("endpoint").eq("ministry_id", address.ministryId),
    supabase.rpc("my_notification_settings"),
    getAppSettings(),
  ]);
  const rows = (types ?? []) as NotificationTypeRow[];

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
        <p className="mt-1 text-sm opacity-90">Notifications</p>
        <HeaderWordmark />
      </header>
      <main className="max-w-2xl mx-auto px-4 py-6 space-y-4">
        <NotificationsCard
          publicKey={vapidPublicKey()}
          savedEndpoints={(pushRows ?? []).map((r) => r.endpoint as string)}
          hasTypes={rows.length > 0}
        />
        <NotificationTypesCard rows={rows} />
      </main>
    </div>
  );
}
