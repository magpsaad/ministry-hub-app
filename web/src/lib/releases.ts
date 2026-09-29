import { createClient } from "@/lib/supabase/server";

export type AppRelease = {
  id: string;
  version: string;
  description: string | null;
  released_on: string;
};

/** Version Control's release history (MULTI_TENANT_PLAN.md P9) -- one
 * church-wide list, edited only in the Church Admin console and shown in
 * every ministry. Newest first, since that's also the one shown as the
 * "Version X" badge. */
export async function getReleases(): Promise<AppRelease[]> {
  const supabase = await createClient();
  const { data } = await supabase
    .from("app_releases")
    .select("id, version, description, released_on")
    .order("released_on", { ascending: false })
    .order("created_at", { ascending: false });
  return data ?? [];
}

/** The newest release's version number, or null if none is logged yet. */
export async function getLatestReleaseVersion(): Promise<string | null> {
  const supabase = await createClient();
  const { data } = await supabase
    .from("app_releases")
    .select("version")
    .order("released_on", { ascending: false })
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle();
  return data?.version ?? null;
}
