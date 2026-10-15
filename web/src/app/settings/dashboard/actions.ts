"use server";

import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import { DASHBOARD_PANELS, type DashboardPanel } from "@/lib/dashboard-prefs";

/** My Settings -> Dashboard: one panel starts open (true) or collapsed. */
export async function setDashboardPrefAction(panel: DashboardPanel, open: boolean) {
  if (!(DASHBOARD_PANELS as readonly string[]).includes(panel) || typeof open !== "boolean") {
    return { error: "Unknown panel." };
  }
  const supabase = await createClient();
  const { error } = await supabase.rpc("set_dashboard_pref", { p_panel: panel, p_open: open });
  if (error) return { error: error.message };
  revalidatePath("/", "layout");
  return { error: null };
}
