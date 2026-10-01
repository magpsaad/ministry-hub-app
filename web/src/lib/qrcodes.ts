import { headers } from "next/headers";
import QRCode from "qrcode";
import { createClient } from "@/lib/supabase/server";
import { getAppSettings } from "@/lib/app-settings";

/** Embeds the app logo in the center of a QR SVG (matches the old app's
 * look). Error-correction level "H" (~30% redundancy) is required so
 * covering the center ~20% of the code with a logo doesn't break
 * scannability. */
function embedLogo(svg: string, logoUrl: string): string {
  const viewBoxMatch = svg.match(/viewBox="0 0 ([\d.]+) ([\d.]+)"/);
  if (!viewBoxMatch) return svg;
  const vbWidth = parseFloat(viewBoxMatch[1]);
  const vbHeight = parseFloat(viewBoxMatch[2]);
  const cx = vbWidth / 2;
  const cy = vbHeight / 2;
  const logoSize = vbWidth * 0.22;
  const backdropRadius = vbWidth * 0.15;

  const safeHref = logoUrl.replace(/&/g, "&amp;");
  const overlay = `<defs><clipPath id="qrLogoClip"><circle cx="${cx}" cy="${cy}" r="${logoSize / 2}" /></clipPath></defs>` +
    `<circle cx="${cx}" cy="${cy}" r="${backdropRadius}" fill="#ffffff" />` +
    `<image href="${safeHref}" x="${cx - logoSize / 2}" y="${cy - logoSize / 2}" width="${logoSize}" height="${logoSize}" preserveAspectRatio="xMidYMid slice" clip-path="url(#qrLogoClip)" />`;

  return svg.replace("</svg>", `${overlay}</svg>`);
}

export type QrCodeForPrinting = {
  id: string;
  label: string;
  checkInUrl: string;
  svg: string;
  color: string;
  /** D13 -- other groups that check in with this code (hidden ones are
   * named to Admins only). */
  sharedWith: string[];
};

async function siteOrigin(): Promise<string> {
  const h = await headers();
  const proto = h.get("x-forwarded-proto") ?? "http";
  const host = h.get("host");
  return `${proto}://${host}`;
}

/**
 * REQUIREMENTS.md §6.15 -- generates real, scannable QR codes on the fly
 * (the `qrcode` package, no external service/cost) pointing at each
 * group's (or the shared Servants QR's) check-in URL. Printable by anyone
 * who can see them, at any time (the old "Mark as Printed" tracking was
 * removed -- MULTI_TENANT_PLAN.md P3).
 *
 * Ordered Servants first, then the groups' display order (GROUP_LADDER_PLAN
 * §4.5). The pre-entry and hand-over codes appear only while their "QR code
 * active" switch is on, for everyone, Admins included (D5, Q4 = No), and a
 * code other groups share lists them (D13). Reads through
 * get_qr_codes_with_groups() rather than a plain embedded-join select:
 * groups_select's position-0 branch stays Admin-only for every OTHER
 * screen, so a plain select's embedded `groups` join for the Yr0 row
 * would silently resolve to null for anyone else -- indistinguishable,
 * if you keyed off that, from the true Servants QR (qr_codes.group_id
 * itself IS null), which is exactly the bug this replaced ("SAY Servants"
 * shown twice, Yr0 nowhere). group_id/label live on qr_codes itself
 * (label already synced from the group's real name whenever it's set, or
 * "SAY Servants" for the true group-less row -- REQUIREMENTS.md §6.15),
 * so no override/fallback logic is needed here at all -- just read it.
 */
export async function getQrCodesForPrinting(): Promise<QrCodeForPrinting[]> {
  const supabase = await createClient();
  const [origin, settings] = await Promise.all([siteOrigin(), getAppSettings()]);

  const { data } = await supabase.rpc("get_qr_codes_with_groups");

  const rows = (data ?? []) as {
    id: string;
    label: string;
    check_in_token: string;
    group_id: string | null;
    display_order: number | null;
    qr_color: string | null;
    shared_with: string[] | null;
  }[];

  const sorted = [...rows].sort((a, b) => {
    const rank = (r: (typeof rows)[number]) => (r.group_id === null ? -1 : (r.display_order ?? 999));
    return rank(a) - rank(b);
  });

  return Promise.all(
    sorted.map(async (r) => {
      const checkInUrl = `${origin}/checkin/${r.check_in_token}`;
      const rawSvg = await QRCode.toString(checkInUrl, {
        type: "svg",
        margin: 1,
        width: 220,
        errorCorrectionLevel: "H",
      });
      const svg = settings.logo_url ? embedLogo(rawSvg, settings.logo_url) : rawSvg;
      // The group-less Servants QR has no group row to hang a colour on --
      // its colour is an App Setting (was hard-coded).
      const color = r.qr_color ?? settings.servants_qr_color;

      return { id: r.id, label: r.label, checkInUrl, svg, color, sharedWith: r.shared_with ?? [] };
    }),
  );
}
