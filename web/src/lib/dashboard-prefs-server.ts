import { cache } from "react";
import { createClient } from "@/lib/supabase/server";
import { DASHBOARD_PANELS, DEFAULT_START_OPEN, type DashboardPanel, type DashboardStartOpen } from "@/lib/dashboard-prefs";

/** This person's choices from My Settings -> Dashboard (migration 0116). */
export const getDashboardStartOpen = cache(async (): Promise<DashboardStartOpen> => {
  const supabase = await createClient();
  const { data } = await supabase.rpc("my_dashboard_prefs");
  const result = { ...DEFAULT_START_OPEN };
  for (const row of (data ?? []) as { panel: string; start_open: boolean }[]) {
    if ((DASHBOARD_PANELS as readonly string[]).includes(row.panel)) result[row.panel as DashboardPanel] = row.start_open;
  }
  return result;
});
