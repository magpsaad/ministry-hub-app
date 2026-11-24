import type { jsPDF as JsPdf } from "jspdf";
import type { create as createQr } from "qrcode";
import { printable } from "@/lib/calendar-export-pdf";

/** Owner-reported (24 Nov 2026): Print All on QR Codes does nothing on an
 * iPhone (Apple ignores a page's request to print, above all in the app
 * opened from the home screen icon); on a computer it works. On an iPhone
 * or iPad the same pages are made as a PDF instead and handed to the
 * phone's share menu, where Print is one tap away.
 *
 * One code per 4x6 page, laid out like the printed page (globals.css
 * @page and QrCodesInteractive's print: classes): the colored frame, the
 * white box with the code, the ministry logo in the middle, and the name
 * in a pill overlapping the bottom of the frame. The code is drawn as
 * shapes, not a picture, so it stays sharp at any size. Pure, so it can be
 * checked outside the browser. */

export type QrPdfCode = { label: string; color: string; checkInUrl: string };

const PAGE_W = 288; // 4 x 6 in, in points
const PAGE_H = 432;
const BOX = 230.4; // the white box: 3.2 in
const BOX_PAD = 9;
const FRAME_PAD = 24;
const PILL_OVERLAP = 12;
const PILL_PAD_X = 24;
const PILL_PAD_Y = 9;

/** Black or white text, whichever reads on the color (as on screen). */
export function qrLabelColor(hex: string): "#000000" | "#FFFFFF" {
  const r = parseInt(hex.slice(1, 3), 16);
  const g = parseInt(hex.slice(3, 5), 16);
  const b = parseInt(hex.slice(5, 7), 16);
  return (0.299 * r + 0.587 * g + 0.114 * b) / 255 > 0.6 ? "#000000" : "#FFFFFF";
}

function rgb(hex: string): [number, number, number] {
  const h = /^#[0-9a-f]{6}$/i.test(hex) ? hex : "#1a5490";
  return [parseInt(h.slice(1, 3), 16), parseInt(h.slice(3, 5), 16), parseInt(h.slice(5, 7), 16)];
}

export function buildQrCodesPdf(
  JsPDF: typeof JsPdf,
  create: typeof createQr,
  { codes, logoPng }: { codes: QrPdfCode[]; logoPng: string | null },
): JsPdf {
  const doc = new JsPDF({ unit: "pt", format: [PAGE_W, PAGE_H], orientation: "portrait" });
  const frame = BOX + FRAME_PAD * 2;

  codes.forEach((code, i) => {
    if (i > 0) doc.addPage([PAGE_W, PAGE_H], "portrait");
    const color = rgb(code.color);
    const textColor = rgb(qrLabelColor(code.color));

    // The name: 22.5 pt bold, made smaller if a long name would run off the page.
    const label = printable(code.label);
    doc.setFont("helvetica", "bold");
    let size = 22.5;
    doc.setFontSize(size);
    while (size > 10 && doc.getTextWidth(label) + PILL_PAD_X * 2 > PAGE_W - 8) {
      size -= 0.5;
      doc.setFontSize(size);
    }
    const pillH = size * 1.2 + PILL_PAD_Y * 2;
    const pillW = doc.getTextWidth(label) + PILL_PAD_X * 2;

    const top = (PAGE_H - (frame + pillH - PILL_OVERLAP)) / 2;
    const left = (PAGE_W - frame) / 2;

    doc.setFillColor(...color);
    doc.roundedRect(left, top, frame, frame, 18, 18, "F");
    doc.setFillColor(255, 255, 255);
    doc.roundedRect(left + FRAME_PAD, top + FRAME_PAD, BOX, BOX, 12, 12, "F");

    // The code itself, error correction H (as on screen), one module of
    // quiet zone, each row's dark runs as single rectangles.
    const qr = create(code.checkInUrl, { errorCorrectionLevel: "H" }).modules;
    const area = BOX - BOX_PAD * 2;
    const cells = qr.size + 2;
    const m = area / cells;
    const x0 = left + FRAME_PAD + BOX_PAD + m;
    const y0 = top + FRAME_PAD + BOX_PAD + m;
    doc.setFillColor(0, 0, 0);
    for (let r = 0; r < qr.size; r++) {
      let c = 0;
      while (c < qr.size) {
        if (!qr.get(r, c)) {
          c++;
          continue;
        }
        const start = c;
        while (c < qr.size && qr.get(r, c)) c++;
        // A hair of overlap so no white seams show between modules.
        doc.rect(x0 + start * m, y0 + r * m, (c - start) * m + 0.15, m + 0.15, "F");
      }
    }

    if (logoPng) {
      const cx = left + FRAME_PAD + BOX_PAD + area / 2;
      const cy = top + FRAME_PAD + BOX_PAD + area / 2;
      doc.setFillColor(255, 255, 255);
      doc.circle(cx, cy, area * 0.15, "F");
      const d = area * 0.22;
      doc.addImage(logoPng, "PNG", cx - d / 2, cy - d / 2, d, d, "logo");
    }

    const pillTop = top + frame - PILL_OVERLAP;
    doc.setFillColor(...color);
    doc.roundedRect((PAGE_W - pillW) / 2, pillTop, pillW, pillH, pillH / 2, pillH / 2, "F");
    doc.setTextColor(...textColor);
    doc.text(label, PAGE_W / 2, pillTop + pillH / 2, { align: "center", baseline: "middle" });
  });

  return doc;
}
