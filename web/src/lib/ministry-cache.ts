import { unstable_cache } from "next/cache";
import { createClient as createPlainClient } from "@supabase/supabase-js";

/** Owner-approved (17 Oct 2026): each ministry's settings -- its
 * app_settings row, schools, Actions Needed thresholds and banner verses --
 * and the latest release number are kept in ONE shared copy (Next.js's
 * cache, which Vercel keeps centrally for every server), instead of being
 * read from the database on every page open. Ministry settings are set up
 * once and rarely change, and nobody needs a change the same second.
 *
 * - Every app screen that saves one of them clears that ministry's copy
 *   (lib/ministry-cache-refresh.ts); the next page open, by anyone, reads
 *   it afresh once.
 * - The Church Admin console has "Refresh ministry settings" for changes
 *   made outside the app (database scripts, migrations).
 * - A copy older than a day is read again anyway, so a missed refresh
 *   corrects itself.
 * - Read WITHOUT anyone's sign-in (a plain client sending only this
 *   address's ministry), so one copy serves everybody. These are setting
 *   values only; who may do what is still checked by the database on
 *   every call, against the live settings.
 */

const ENV = process.env.NEXT_PUBLIC_APP_ENV as "qa" | "prod";
const ONE_DAY = 86_400;
/** Bump to discard every stored copy (a change in what's stored). */
const CACHE_VERSION = "1";

export function ministrySettingsTag(ministryId: string): string {
  return `ministry-settings:${ENV}:${ministryId}`;
}
export const RELEASE_TAG = `app-release:${ENV}`;

function plainClient(ministryId: string | null) {
  return createPlainClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY!, {
    db: { schema: ENV },
    auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false },
    global: { headers: ministryId ? { "x-ministry-id": ministryId } : {} },
  });
}

/** One ministry's copy of something, tagged so a save can clear it. */
function perMinistry<T>(name: string, ministryId: string, read: (m: string) => Promise<T>, extraKey = ""): Promise<T> {
  return unstable_cache(read, [name, ENV, CACHE_VERSION, extraKey], {
    tags: [ministrySettingsTag(ministryId)],
    revalidate: ONE_DAY,
  })(ministryId);
}

/** The app_settings row (the columns asked for -- part of the copy's key,
 * so adding a column never serves an older copy without it). */
export function cachedSettingsRow(ministryId: string, columns: string): Promise<Record<string, unknown>> {
  return perMinistry(
    "app-settings",
    ministryId,
    async (m) => {
      const { data, error } = await plainClient(m).from("app_settings").select(columns).single();
      if (error || !data) throw new Error(`App settings could not be loaded${error ? `: ${error.message}` : ""}`);
      return data as unknown as Record<string, unknown>;
    },
    columns,
  );
}

export function cachedUniversities<T>(ministryId: string): Promise<T[]> {
  return perMinistry("universities", ministryId, async (m) => {
    const { data, error } = await plainClient(m).from("universities").select("id, name, proximity").order("name");
    if (error) throw new Error(error.message);
    return (data ?? []) as T[];
  });
}

export function cachedActionsNeededConfig<T>(ministryId: string): Promise<T[]> {
  return perMinistry("actions-needed-config", ministryId, async (m) => {
    const { data, error } = await plainClient(m).rpc("ministry_actions_needed_config");
    if (error) throw new Error(error.message);
    return (data ?? []) as T[];
  });
}

export function cachedActiveVerses(ministryId: string): Promise<{ text: string; reference: string | null }[]> {
  return perMinistry("verses", ministryId, async (m) => {
    const { data, error } = await plainClient(m).rpc("ministry_active_verses");
    if (error) throw new Error(error.message);
    return (data ?? []) as { text: string; reference: string | null }[];
  });
}

/** The latest release number, church-wide. */
export function cachedLatestReleaseVersion(): Promise<string | null> {
  return unstable_cache(
    async () => {
      const { data, error } = await plainClient(null)
        .from("app_releases")
        .select("version")
        .order("released_on", { ascending: false })
        .order("created_at", { ascending: false })
        .limit(1)
        .maybeSingle();
      if (error) throw new Error(error.message);
      return (data?.version as string | undefined) ?? null;
    },
    ["latest-release", ENV, CACHE_VERSION],
    { tags: [RELEASE_TAG], revalidate: ONE_DAY },
  )();
}
