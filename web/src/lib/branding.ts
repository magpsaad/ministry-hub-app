import { cache } from "react";
import { createClient as createPlainClient } from "@supabase/supabase-js";
import { getAddressContext } from "@/lib/ministry-context";
import { getAppSettings, type AppSettings } from "@/lib/app-settings";
import { getLatestReleaseVersion } from "@/lib/releases";

/** The part of App Settings the page chrome needs (root layout, manifest,
 * login page). */
export type Branding = Pick<
  AppSettings,
  | "app_title_long"
  | "app_title_short"
  | "app_subtitle"
  | "logo_url"
  | "theme_color"
  | "theme_color_light"
  | "theme_color_dark"
  | "my_assigned_header_color"
  | "my_assigned_header_color_light"
  | "timezone"
  | "app_version"
>;

/** Neutral chrome for addresses that belong to no ministry -- the Church
 * Admin console and an address nobody set up. Deliberately not any
 * ministry's name, logo or colours (MULTI_TENANT_PLAN.md §3.2, A11). The
 * timezone is replaced by the church's (below). */
const NEUTRAL: Omit<Branding, "app_title_long" | "app_title_short" | "app_subtitle" | "app_version"> = {
  logo_url: null,
  theme_color: "#334155",
  theme_color_light: "#475569",
  theme_color_dark: "#1e293b",
  my_assigned_header_color: "#334155",
  my_assigned_header_color_light: "#475569",
  timezone: "UTC",
};

/**
 * Branding for this request's address: the ministry's own App Settings on a
 * ministry's address, neutral chrome anywhere else. Never cached across
 * addresses -- it reads the request's host every time (§14, R16).
 * React.cache()-memoized per request.
 */
/** Owner-reported (5 Oct 2026): the console worked in UTC, so at 8:22 PM in
 * Toronto its Release Notes date already said tomorrow. Addresses that
 * belong to no ministry use the console's own timezone (Console ->
 * Settings; migration 0091's church_timezone()). */
const getChurchTimezone = cache(async (): Promise<string> => {
  const supabase = createPlainClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY!, {
    db: { schema: process.env.NEXT_PUBLIC_APP_ENV as "qa" | "prod" },
    auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false },
  });
  const { data } = await supabase.rpc("church_timezone");
  return typeof data === "string" && data ? data : NEUTRAL.timezone;
});

export const getBranding = cache(async (): Promise<Branding> => {
  const ctx = await getAddressContext();
  if (ctx.kind === "ministry") return getAppSettings();
  if (ctx.kind === "console") {
    return {
      ...NEUTRAL,
      timezone: await getChurchTimezone(),
      app_title_long: "Church Admin Console",
      app_title_short: "Church Admin",
      app_subtitle: "Ministries, addresses and release notes",
      app_version: (await getLatestReleaseVersion()) ?? "",
    };
  }
  return {
    ...NEUTRAL,
    timezone: await getChurchTimezone(),
    app_title_long: "Ministry Hub",
    app_title_short: "Ministry Hub",
    app_subtitle: "",
    app_version: "",
  };
});
