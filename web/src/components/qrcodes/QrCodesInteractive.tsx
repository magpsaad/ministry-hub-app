"use client";

import { useEffect, useRef, useState } from "react";
import type { QrCodeForPrinting } from "@/lib/qrcodes";
import { buildQrCodesPdf, qrLabelColor } from "@/lib/qrcodes-pdf";
import { isAppleMobile } from "@/lib/device-label";
import { BusyLabel } from "@/components/PendingButton";

type PdfTools = {
  jsPDF: typeof import("jspdf").jsPDF;
  create: typeof import("qrcode").create;
  logoPng: string | null;
};

/** The ministry logo cut to a circle (as it sits in the middle of the code
 * on screen), as a PNG for the PDF. Without it the code still scans. */
function circleLogo(url: string | null): Promise<string | null> {
  if (!url) return Promise.resolve(null);
  return new Promise((resolve) => {
    const img = new Image();
    img.crossOrigin = "anonymous";
    img.onload = () => {
      try {
        const size = 256;
        const canvas = document.createElement("canvas");
        canvas.width = canvas.height = size;
        const ctx = canvas.getContext("2d");
        if (!ctx) return resolve(null);
        ctx.beginPath();
        ctx.arc(size / 2, size / 2, size / 2, 0, Math.PI * 2);
        ctx.clip();
        // Filled edge to edge, centered (the on-screen "slice").
        const scale = Math.max(size / img.naturalWidth, size / img.naturalHeight);
        const w = img.naturalWidth * scale;
        const h = img.naturalHeight * scale;
        ctx.drawImage(img, (size - w) / 2, (size - h) / 2, w, h);
        resolve(canvas.toDataURL("image/png"));
      } catch {
        resolve(null);
      }
    };
    img.onerror = () => resolve(null);
    img.src = url;
  });
}

async function loadPdfTools(logoUrl: string | null): Promise<PdfTools> {
  const [{ jsPDF }, { create }, logoPng] = await Promise.all([import("jspdf"), import("qrcode"), circleLogo(logoUrl)]);
  return { jsPDF, create, logoPng };
}

/** REQUIREMENTS.md §6.15 -- print-optimized layout for every current QR
 * code, real scannable images generated on the fly (no external service).
 * Colored frame/label matches the old app's actual look (colors sampled
 * directly from its real QR image files, not guessed).
 *
 * Owner-reported (24 Nov 2026): Print All did nothing on an iPhone. On an
 * iPhone or iPad it now makes the same pages as a PDF (lib/qrcodes-pdf.ts)
 * and opens the share menu, which has Print; computers print as before. */
export function QrCodesInteractive({
  qrCodes,
  logoUrl,
  fileTitle,
}: {
  qrCodes: QrCodeForPrinting[];
  logoUrl: string | null;
  fileTitle: string;
}) {
  const tools = useRef<Promise<PdfTools> | null>(null);
  const [makingPdf, setMakingPdf] = useState(false);
  const [pdfError, setPdfError] = useState<string | null>(null);

  // Loaded ahead on Apple phones and tablets only, so the share menu can
  // open straight from the tap (Apple only allows it right after one).
  useEffect(() => {
    if (isAppleMobile()) tools.current = loadPdfTools(logoUrl);
  }, [logoUrl]);

  function save(blob: Blob, name: string) {
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = name;
    document.body.appendChild(a);
    a.click();
    a.remove();
    window.setTimeout(() => URL.revokeObjectURL(url), 60_000);
  }

  async function printOnApple() {
    setMakingPdf(true);
    setPdfError(null);
    try {
      tools.current ??= loadPdfTools(logoUrl);
      const { jsPDF, create, logoPng } = await tools.current;
      const blob = buildQrCodesPdf(jsPDF, create, { codes: qrCodes, logoPng }).output("blob");
      const name = `${fileTitle}.pdf`;
      const file = new File([blob], name, { type: "application/pdf" });
      if (navigator.canShare?.({ files: [file] })) {
        try {
          await navigator.share({ files: [file] });
        } catch (e) {
          // Closing the share menu is fine; anything else, the PDF is saved instead.
          if ((e as Error)?.name !== "AbortError") save(blob, name);
        }
      } else {
        save(blob, name);
      }
    } catch {
      tools.current = null;
      setPdfError("Couldn't make the PDF. Please try again.");
    } finally {
      setMakingPdf(false);
    }
  }

  return (
    <div>
      <div className="print:hidden flex justify-end mb-4">
        <button
          type="button"
          onClick={() => (isAppleMobile() ? void printOnApple() : window.print())}
          disabled={makingPdf || qrCodes.length === 0}
          className="rounded-md bg-brand px-4 py-2 text-sm font-semibold text-white hover:bg-brand-dark shadow-[0_2px_4px_rgba(0,0,0,0.15)] transition-all hover:-translate-y-0.5 hover:shadow-[0_4px_8px_rgba(0,0,0,0.2)] active:translate-y-0 active:shadow-[0_1px_2px_rgba(0,0,0,0.15)] disabled:opacity-60"
        >
          <BusyLabel busy={makingPdf} busyText="Making PDF">
            Print All
          </BusyLabel>
        </button>
      </div>
      {pdfError && (
        <div className="print:hidden mb-4 rounded-md bg-[#f8d7da] text-[#721c24] text-sm px-3 py-2">{pdfError}</div>
      )}

      {/* Owner-reported: "1 QR code per page" didn't hold on mobile print.
          Page breaks inside a CSS Grid container are a long-standing,
          widely-documented cross-browser print bug (grid/flex children
          don't fragment reliably -- desktop Chrome's Print/Save-as-PDF
          happens to cope well enough that this wasn't noticed there, but
          mobile print pipelines expose it consistently). print:block swaps
          the container to a plain block layout for print, so each card is
          an ordinary block-level child -- that's the layout mode
          break-after/break-inside are actually reliably supported in. */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-6 print:block print:gap-0">
        {qrCodes.map((q) => {
          const textColor = qrLabelColor(q.color);
          return (
            <div
              key={q.id}
              // print:min-h-screen used to sit here to vertically-center each
              // code on its own printed page, but `vh` units don't map
              // reliably to an actual printed page's height (a well-known
              // print-CSS pitfall) -- it was overflowing onto a stray extra
              // page for some codes. print:break-after-page alone already
              // guarantees "one code per page" without it. That same class
              // was also unconditionally on the LAST code too, forcing a
              // guaranteed blank page after it -- print:last:break-after-auto
              // undoes it for just that one (owner-reported: both a stray
              // blank page mid-list and one at the very end).
              //
              // Owner-reported: printed too small on 4x6 paper. globals.css
              // now sizes each printed page at 4x6 (@page); this fills that
              // page directly (w-[4in]/h-[6in], centered) instead of the
              // old fixed-px sizing that assumed a full Letter/A4 sheet.
              className="qr-print-card flex flex-col items-center print:break-inside-avoid print:break-after-page print:last:break-after-auto print:w-[4in] print:h-[6in] print:justify-center print:pt-0"
            >
              <div className="rounded-3xl p-3 print:p-8" style={{ backgroundColor: q.color }}>
                {/* Owner-requested: the QR code itself is also a real link
                    to the same check-in page it encodes, so someone
                    viewing this screen can tap it directly instead of
                    scanning with a second device. Print doesn't care about
                    hrefs, so this doesn't need to be gated to on-screen
                    only. */}
                <a href={q.checkInUrl} title={`Open check-in for ${q.label}`}>
                  <div
                    className="rounded-2xl bg-white p-3 w-[220px] print:w-[3.2in] [&_svg]:h-auto [&_svg]:w-full"
                    dangerouslySetInnerHTML={{ __html: q.svg }}
                  />
                </a>
              </div>
              <div
                className="-mt-4 rounded-full px-6 py-2 text-center font-bold shadow-[0_2px_6px_rgba(0,0,0,0.15)] print:px-8 print:py-3 print:text-3xl"
                style={{ backgroundColor: q.color, color: textColor }}
              >
                {q.label}
              </div>
              {q.sharedWith.length > 0 && (
                <p className="mt-2 text-xs text-[#666] print:hidden">Also used by {q.sharedWith.join(", ")}</p>
              )}

            </div>
          );
        })}
        {qrCodes.length === 0 && <p className="text-sm text-[#666] col-span-full text-center py-8">No QR codes yet.</p>}
      </div>
    </div>
  );
}
