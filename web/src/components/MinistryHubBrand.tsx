import Image from "next/image";

/** The app's own name and logo, Ministry Hub (owner-requested, 3 Oct 2026).
 * Shown only where the app itself speaks -- never in place of a ministry's
 * own logo, and never on youth-facing check-in pages. Images in
 * public/brand/, made from the owner's "MinistryHub Logo.png" and
 * "MinistryHub Name.png":
 *   ministryhub-mark.png        the circular emblem only (no name, no white
 *                               space, transparent background)
 *   ministryhub-name.png        the name, navy and orange, for light backgrounds
 *   ministryhub-name-light.png  white and orange, for the coloured headers
 *   ministryhub-icon-*.png      the emblem on white, for tab/home-screen icons */
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

/** The circular emblem. `onDark` puts it on a white circle: its navy ring
 * would disappear on a dark header. */
export function MinistryHubLogo({ size, onDark = false }: { size: number; onDark?: boolean }) {
  if (onDark) {
    const inner = Math.round(size * 0.8);
    return (
      <span
        className="shrink-0 inline-flex items-center justify-center rounded-full bg-white shadow-[0_2px_10px_rgba(0,0,0,0.2)]"
        style={{ width: size, height: size }}
      >
        <Image src="/brand/ministryhub-mark.png" alt={MINISTRY_HUB_NAME} width={inner} height={inner} />
      </span>
    );
  }
  return <Image src="/brand/ministryhub-mark.png" alt={MINISTRY_HUB_NAME} width={size} height={size} className="shrink-0" />;
}

/** The name as an image: navy and orange on light backgrounds, `light` =
 * white and orange for the coloured headers. Size it with a height class. */
export function MinistryHubName({ light = false, className = "" }: { light?: boolean; className?: string }) {
  return (
    <Image
      src={light ? "/brand/ministryhub-name-light.png" : "/brand/ministryhub-name.png"}
      alt={MINISTRY_HUB_NAME}
      width={444}
      height={80}
      className={`w-auto ${className}`}
    />
  );
}
