import type { Metadata, Viewport } from "next";
import { Inter } from "next/font/google";
import Script from "next/script";
import { getBranding } from "@/lib/branding";
import { getAddressContext } from "@/lib/ministry-context";
import { QaEnvBanner } from "@/components/QaEnvBanner";
import { TimezoneProvider } from "@/components/TimezoneProvider";
import { ScreenLock } from "@/components/ScreenLock";
import "./globals.css";

const inter = Inter({
  variable: "--font-inter",
  subsets: ["latin"],
});

export async function generateMetadata(): Promise<Metadata> {
  const settings = await getBranding();
  // Owner-requested: the logo as the "Add to Home Screen" icon -- iOS
  // Safari specifically needs an apple-touch-icon link (separate from the
  // manifest.ts icons Android reads). Owner tried it on qa, approved, then
  // asked for prod-only permanently -- kept in sync with manifest.ts's
  // identical check.
  const isProd = process.env.NEXT_PUBLIC_APP_ENV === "prod";
  const useLogo = isProd && !!settings.logo_url;
  // Owner-requested: the console (no ministry, so no Ministry Settings
  // logo) gets the app's own logo, Ministry Hub (3 Oct 2026; it replaced
  // the Coptic cross), as its browser-tab icon in QA and production, and as
  // its home-screen icon in production only (same prod-only rule), on an
  // opaque white square since iOS fills transparency with black.
  const isConsole = (await getAddressContext()).kind === "console";
  const consoleIcon = isProd && isConsole;
  return {
    title: {
      default: settings.app_title_long,
      template: `%s · ${settings.app_title_short}`,
    },
    description: settings.app_subtitle,
    applicationName: settings.app_title_short,
    appleWebApp: {
      capable: true,
      statusBarStyle: "default",
      title: settings.app_title_short,
    },
    // The tab icon is set here, not by app/favicon.ico, so each address can
    // have its own (a file-based favicon would be added to every page).
    // Owner-requested (3 Oct 2026): a ministry's tab shows its own logo
    // (QA and production); the default icon only when it has none.
    icons: {
      icon: isConsole ? "/brand/ministryhub-icon-192.png" : (settings.logo_url ?? "/favicon.ico"),
      ...(consoleIcon ? { apple: "/brand/ministryhub-icon-180.png" } : useLogo ? { apple: settings.logo_url! } : {}),
    },
  };
}

export async function generateViewport(): Promise<Viewport> {
  const settings = await getBranding();
  return {
    themeColor: settings.theme_color,
    width: "device-width",
    initialScale: 1,
  };
}

export default async function RootLayout({ children }: LayoutProps<"/">) {
  // Brand colours and timezone come from THIS address's ministry's App
  // Settings (neutral chrome on the console or an unknown address), never
  // hard-coded (MULTI_TENANT_PLAN.md §3.2, §10 A1/A9). Read per request, so
  // one ministry's branding can never be served on another's address. The
  // colours become CSS variables that globals.css maps to Tailwind's
  // `brand` / `brand-light` / `brand-dark`.
  const settings = await getBranding();
  const brandVars = {
    "--brand": settings.theme_color,
    "--brand-light": settings.theme_color_light,
    "--brand-dark": settings.theme_color_dark,
    "--my-assigned": settings.my_assigned_header_color,
    "--my-assigned-light": settings.my_assigned_header_color_light,
  } as React.CSSProperties;

  return (
    <html lang="en" className={`${inter.variable} h-full antialiased`} style={brandVars}>
      <body className="min-h-full flex flex-col">
        {/* Deliberate one-off exception to "no colored/alarming UI" -- this
         * banner's whole job is to be impossible to miss, not to blend in.
         * REQUIREMENTS.md §10.2/MIGRATION_PLAN.md -- QA and Production are
         * two different websites sharing one login system (§1.1), and real
         * servants will have QA access to help test before each change is
         * promoted to prod (owner-confirmed, not just the owner testing
         * alone) -- a plain identical-looking header gave nobody a way to
         * notice they'd landed on the wrong one. Bright orange + explicit
         * wording, owner's exact spec. Env-gated (`NEXT_PUBLIC_APP_ENV`),
         * so it only ever renders on the QA deployment, never prod. Sticky,
         * and (see QaEnvBanner.tsx) publishes its own height so every page
         * header below can stick directly beneath it. */}
        {process.env.NEXT_PUBLIC_APP_ENV === "qa" && <QaEnvBanner />}
        {/* REQUIREMENTS.md §8.1 -- 2.5D buttons' press-down feel on touch (2nd
         * round). The first fix (a no-op touchstart listener, the standard
         * workaround for iOS Safari's :active-doesn't-fire-on-tap quirk)
         * wasn't enough -- owner still saw no movement on a real phone. Not
         * chasing that pseudo-class any further: this delegates real
         * pointerdown/pointerup events to stamp `data-pressed="true"` on
         * whichever button/link was actually touched (see the matching
         * `[data-pressed="true"]` rule in globals.css), which fires
         * identically and reliably on iOS, Android, and desktop alike,
         * since it isn't going through `:active` at all. One listener here
         * covers every current and future button/link app-wide -- no need
         * to touch each of the ~75 buttons individually.
         *
         * Round 3 (owner still saw nothing across multiple mobile browsers,
         * which -- since every iOS browser is WebKit under the hood, Apple
         * mandates it -- points at this being an iPhone, where the visual
         * effect above genuinely may be muted/inconsistent for reasons
         * specific to that engine). Added actual haptic feedback via the
         * Vibration API as a second, independent feedback channel: a short
         * buzz on tap, real physical "tactile feedback" rather than
         * something you have to see. IMPORTANT PLATFORM LIMIT: the
         * Vibration API is supported on Android (Chrome, Firefox, Samsung
         * Internet, Edge) but Apple has never implemented it in WebKit, on
         * *any* iOS browser -- this is an OS-level restriction, not
         * something fixable from here. `navigator.vibrate` is
         * feature-detected, so this is a silent no-op on iOS/desktop and
         * only ever does something on Android.
         * `next/script` (not a raw <script> tag) so it survives client-side
         * route transitions, not just the very first page load. */}
        <Script id="press-feedback" strategy="afterInteractive">
          {`(function () {
            function target(el) { return el && el.closest ? el.closest("button, a[href]") : null; }
            function clearAll() {
              document.querySelectorAll('[data-pressed="true"]').forEach(function (el) {
                el.removeAttribute("data-pressed");
              });
            }
            document.addEventListener("pointerdown", function (e) {
              var t = target(e.target);
              if (t) t.setAttribute("data-pressed", "true");
            }, { passive: true });
            ["pointerup", "pointercancel", "pointerleave"].forEach(function (type) {
              document.addEventListener(type, clearAll, { passive: true });
            });
            document.addEventListener("click", function (e) {
              var t = target(e.target);
              if (t && typeof navigator !== "undefined" && navigator.vibrate) {
                navigator.vibrate(10);
              }
            });
          })();`}
        </Script>
        <TimezoneProvider timeZone={settings.timezone}>{children}</TimezoneProvider>
        {/* Screen lock (migration 0089): does nothing unless this ministry
            turned it on and someone is signed in. */}
        <ScreenLock />
      </body>
    </html>
  );
}
