import { getConsoleAccess } from "@/lib/console";
import { getBranding } from "@/lib/branding";
import { ConsoleShell, NotAuthorized } from "@/components/console/ConsoleShell";
import { ConsoleTimezoneForm } from "./ConsoleTimezoneForm";

/** The console's own settings (migration 0091): for now its timezone, used
 * for every date shown or defaulted on the console (Release Notes'
 * "released on", for one). Each ministry keeps its own timezone in its
 * Ministry Settings; this one belongs to the console alone. */
export default async function ConsoleSettingsPage() {
  const access = await getConsoleAccess();
  if (!access.isChurchAdmin) return <NotAuthorized email={access.email} />;

  const branding = await getBranding();

  return (
    <ConsoleShell title="Settings" email={access.email}>
      <ConsoleTimezoneForm initial={branding.timezone} />
    </ConsoleShell>
  );
}
