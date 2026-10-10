import { headers } from "next/headers";
import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { AppLogo } from "@/components/AppLogo";
import { HeaderWordmark } from "@/components/MinistryHubBrand";
import { MenuButton } from "@/components/MenuButton";
import { BackButton } from "@/components/BackButton";
import { RefreshButton } from "@/components/RefreshButton";
import { getAppSettings } from "@/lib/app-settings";
import { getAddressContext } from "@/lib/ministry-context";
import { CalendarFeedCard } from "./CalendarFeedCard";
import { HomeLink } from "@/components/HomeLink";

/** My Settings -> Calendar Sync (owner-approved 9 Oct 2026, migration
 * 0107): a private link that puts this ministry's Service Calendar in my
 * own Google / Apple / Outlook calendar, kept up to date, one way only.
 * Ministry-branded: the link belongs to this ministry's address. */
export default async function CalendarSyncPage() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect("/login");
  const address = await getAddressContext();
  if (address.kind !== "ministry") redirect("/security");

  const [settings, { data: token }, h] = await Promise.all([getAppSettings(), supabase.rpc("my_calendar_feed"), headers()]);
  const host = h.get("x-forwarded-host") ?? h.get("host") ?? "";
  const proto = h.get("x-forwarded-proto") ?? (host.startsWith("localhost") ? "http" : "https");
  const feedUrl = typeof token === "string" && token ? `${proto}://${host}/api/calendar/${token}.ics` : null;

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
        <p className="mt-1 text-sm opacity-90">Calendar Sync</p>
        <HeaderWordmark />
      </header>
      <main className="max-w-2xl mx-auto px-4 py-6 space-y-4">
        <CalendarFeedCard feedUrl={feedUrl} calendarName={`${settings.app_title_short} Service Calendar`} />
      </main>
    </div>
  );
}
