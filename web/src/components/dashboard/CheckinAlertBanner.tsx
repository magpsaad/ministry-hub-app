import { createClient } from "@/lib/supabase/server";
import { getAppSettings } from "@/lib/app-settings";
import { CheckinAlertList, type CheckinAlert } from "./CheckinAlertList";

/** Security audit #2 (owner-requested, 4 Oct 2026; migration 0080): when
 * more than 10 people sign up through check-in posters within an hour, the
 * database records an alert. Admins see it at the top of the Dashboard
 * until one of them marks it reviewed. Everyone else gets nothing (the
 * database only shows alerts to Admins). */
export async function CheckinAlertBanner() {
  const supabase = await createClient();
  const [{ data }, settings] = await Promise.all([
    supabase
      .from("checkin_alerts")
      .select("id, created_at, signups_last_hour")
      .is("reviewed_at", null)
      .order("created_at", { ascending: false })
      .limit(5),
    getAppSettings(),
  ]);
  const alerts = (data ?? []) as CheckinAlert[];
  if (alerts.length === 0) return null;
  return <CheckinAlertList alerts={alerts} timeZone={settings.timezone ?? undefined} />;
}
