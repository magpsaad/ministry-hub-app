import Image from "next/image";

/** The app's own name and logo, Ministry Hub (owner-requested, 3 Oct 2026).
 * Shown only where the app itself speaks -- never in place of a ministry's
 * own logo, and never on youth-facing check-in pages. Images in
 * public/brand/ (made from the owner's "MinistryHub Logo.png" and
 * "MinistryHub Name.png": logo corners made transparent, the name on a
 * transparent background, plus a white-and-orange version for the coloured
 * headers, where the navy "Ministry" wouldn't show). */
export const MINISTRY_HUB_NAME = "Ministry Hub";

/** The name in the bottom-right corner of a coloured page header (the
 * header must be `relative`). */
export function HeaderWordmark() {
  return (
    <Image
      src="/brand/ministryhub-name-light.png"
      alt={MINISTRY_HUB_NAME}
      width={444}
      height={80}
      className="pointer-events-none absolute bottom-1.5 right-3 h-3.5 w-auto opacity-90"
    />
  );
}

/** The square logo tile (rounded white tile, transparent corners). */
export function MinistryHubLogo({ size, className = "" }: { size: number; className?: string }) {
  return (
    <Image
      src="/brand/ministryhub-logo.png"
      alt={MINISTRY_HUB_NAME}
      width={size}
      height={size}
      className={`shrink-0 ${className}`}
    />
  );
}

/** The name on a white background (navy "Ministry", orange "Hub"). */
export function MinistryHubName({ className = "" }: { className?: string }) {
  return (
    <Image
      src="/brand/ministryhub-name.png"
      alt={MINISTRY_HUB_NAME}
      width={444}
      height={80}
      className={`w-auto ${className}`}
    />
  );
}
