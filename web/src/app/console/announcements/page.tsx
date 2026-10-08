import { getConsoleAccess, listMinistries } from "@/lib/console";
import { getBranding } from "@/lib/branding";
import { todayInZone, shiftDateKey } from "@/lib/timezone";
import { ConsoleShell, NotAuthorized } from "@/components/console/ConsoleShell";
import { ConsoleAnnouncementForm } from "./ConsoleAnnouncementForm";

/** Church Admin console -> Announcements (migration 0099): one announcement
 * posted to the ministries picked. Each ministry then shows it like its own
 * (Dashboard banner or Important pop-up, Announcements page, phones); it's
 * edited or taken down from that ministry's Announcements page. */
export default async function ConsoleAnnouncementsPage() {
  const access = await getConsoleAccess();
  if (!access.isChurchAdmin) return <NotAuthorized email={access.email} />;

  const [ministries, branding] = await Promise.all([listMinistries(), getBranding()]);
  const today = todayInZone(branding.timezone);

  return (
    <ConsoleShell title="Announcements" email={access.email}>
      <ConsoleAnnouncementForm
        ministries={ministries.filter((m) => m.is_active).map((m) => ({ id: m.id, name: m.name }))}
        today={today}
        defaultEnd={shiftDateKey(today, { days: 7 })}
      />
    </ConsoleShell>
  );
}
