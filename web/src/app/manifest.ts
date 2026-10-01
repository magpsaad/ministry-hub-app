import type { MetadataRoute } from "next";
import { getBranding } from "@/lib/branding";
import { getAddressContext } from "@/lib/ministry-context";

/** PWA "Add to Home Screen" icon (Android Chrome/Chromium) -- owner-
 * requested: use the ministry's own configured logo (app_settings.logo_url)
 * instead of no icon at all (there was no manifest here before this).
 *
 * Owner tried it out on qa first, approved, then asked for prod-only
 * permanently: prod gets the branded icon, qa stays on the generic one,
 * deliberately so the two are visually distinguishable at a glance on a
 * home screen (kept in sync with layout.tsx's generateMetadata, which
 * needs the identical check).
 *
 * Built per request from the address it's fetched on, so each ministry's
 * address gets its own name, colour and home-screen icon
 * (MULTI_TENANT_PLAN.md §8, R16).
 */
export default async function manifest(): Promise<MetadataRoute.Manifest> {
  const settings = await getBranding();
  const isProd = process.env.NEXT_PUBLIC_APP_ENV === "prod";
  const useLogo = isProd && !!settings.logo_url;
  // The console's own icon, the church's Coptic cross (see layout.tsx).
  const consoleIcon = isProd && (await getAddressContext()).kind === "console";

  return {
    name: settings.app_title_long,
    short_name: settings.app_title_short,
    start_url: "/",
    display: "standalone",
    background_color: "#f5f5f5",
    theme_color: settings.theme_color,
    icons: consoleIcon
      ? [
          { src: "/console-icon-192.png", sizes: "192x192", type: "image/png" },
          { src: "/console-icon-512.png", sizes: "512x512", type: "image/png" },
        ]
      : useLogo
      ? [
          { src: settings.logo_url!, sizes: "192x192", type: "image/png" },
          { src: settings.logo_url!, sizes: "512x512", type: "image/png" },
        ]
      : [],
  };
}
