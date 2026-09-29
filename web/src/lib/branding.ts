import { cache } from "react";
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
 * ministry's name, logo or colours (MULTI_TENANT_PLAN.md §3.2, A11). No
 * ministry data is shown on these pages, so the timezone is only a
 * formality. */
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
export const getBranding = cache(async (): Promise<Branding> => {
  const ctx = await getAddressContext();
  if (ctx.kind === "ministry") return getAppSettings();
  if (ctx.kind === "console") {
    return {
      ...NEUTRAL,
      app_title_long: "Church Admin Console",
      app_title_short: "Church Admin",
      app_subtitle: "Ministries, addresses and release notes",
      app_version: (await getLatestReleaseVersion()) ?? "",
    };
  }
  return { ...NEUTRAL, app_title_long: "Ministry App", app_title_short: "Ministry App", app_subtitle: "", app_version: "" };
});
