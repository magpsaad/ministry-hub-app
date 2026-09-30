import Link from "next/link";
import { redirect } from "next/navigation";
import { getCurrentUser } from "@/lib/supabase/get-current-user";
import { getAppSettings, weekdayName } from "@/lib/app-settings";
import { getCalendarEvents } from "@/lib/calendar";
import { AppLogo } from "@/components/AppLogo";
import { MenuButton } from "@/components/MenuButton";
import { BackButton } from "@/components/BackButton";
import { RefreshButton } from "@/components/RefreshButton";
import { ServiceCalendar } from "@/components/calendar/ServiceCalendar";

/** REQUIREMENTS.md §6.8 -- the Service Calendar, one ministry-wide calendar
 * (no group). Owner-requested: an ordinary page reached from the side
 * menu's Servant Corner, with the same header as every other page (it used
 * to be a full-screen pop-up, whose Menu button misbehaved). */
export default async function ServiceCalendarPage() {
  const user = await getCurrentUser();
  if (!user) redirect("/login");

  const [settings, events] = await Promise.all([getAppSettings(), getCalendarEvents()]);

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
        <p className="mt-1 text-sm opacity-90">Service Calendar</p>
      </header>
      <ServiceCalendar
        events={events}
        serviceWeekday={settings.service_weekday}
        serviceWeekdayLabel={`${weekdayName(settings.service_weekday)}s`}
      />
    </div>
  );
}
