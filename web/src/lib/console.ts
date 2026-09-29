import { cache } from "react";
import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { getCurrentUser } from "@/lib/supabase/get-current-user";
import { getAddressContext } from "@/lib/ministry-context";

export type ConsoleAccess = { email: string | null; isChurchAdmin: boolean };

/** MULTI_TENANT_PLAN.md §3.8 -- every console page starts here: only on the
 * console's own address, only signed in, and the page shows "Not
 * authorized" to anyone who isn't a Church Admin. (Every console function
 * in the database refuses non-Church-Admins too -- this is the page-level
 * layer, not the only one.) */
export const getConsoleAccess = cache(async (): Promise<ConsoleAccess> => {
  const ctx = await getAddressContext();
  if (ctx.kind !== "console") redirect("/");

  const user = await getCurrentUser();
  if (!user) redirect("/login");

  const supabase = await createClient();
  const { data } = await supabase.rpc("is_church_admin");
  return { email: user.email ?? null, isChurchAdmin: data === true };
});

export type MinistryListRow = {
  id: string;
  name: string;
  is_active: boolean;
  display_order: number;
  created_at: string;
  admin_count: number;
  addresses: string[];
};

/** Every ministry in this environment (the console is the only place this
 * list exists, §3.8). */
export async function listMinistries(): Promise<MinistryListRow[]> {
  const supabase = await createClient();
  const { data, error } = await supabase.rpc("list_ministries");
  if (error) throw new Error(`Could not load the ministries: ${error.message}`);
  return (data ?? []) as MinistryListRow[];
}
