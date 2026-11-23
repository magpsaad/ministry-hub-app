import type { jsPDF as JsPdf } from "jspdf";
import type { CalendarExportRow } from "@/lib/calendar-export";
import { EVENT_TYPE_COLORS, contrastText } from "@/lib/calendar-types";

/** Owner-requested (22 Nov 2026): the calendar export as a PDF, "formatted
 * to look nice" -- a landscape table in the ministry's own color: a title
 * band, what was chosen, one band per month, each event's type as a colored
 * chip (the calendar's own colors), the column headings again on every page,
 * and page numbers. Built on the phone like the CSV (jsPDF, loaded only when
 * someone asks for a PDF). Pure, so it can be checked outside the browser. */

const PAGE_W = 792; // US Letter, landscape, in points
const PAGE_H = 612;
const MARGIN = 36;
const FONT = 9;
const LINE = 11.5;
const PAD = 5;

const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
const MONTH_NAMES = ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"];
const DAYS = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];

function parts(iso: string) {
  const [y, m, d] = iso.split("-").map(Number);
  return { y, m, d, dow: new Date(Date.UTC(y, m - 1, d)).getUTCDay() };
}

/** "Fri, Nov 27" -- the month band above already says the year. */
function shortDate(iso: string): string {
  const p = parts(iso);
  return `${DAYS[p.dow]}, ${MONTHS[p.m - 1]} ${p.d}`;
}

export function longDate(iso: string): string {
  const p = parts(iso);
  return `${MONTHS[p.m - 1]} ${p.d}, ${p.y}`;
}

function dateText(r: CalendarExportRow): string {
  if (!r.endDate) return shortDate(r.date);
  const a = parts(r.date);
  const b = parts(r.endDate);
  return `${shortDate(r.date)} – ${b.y !== a.y ? longDate(r.endDate) : shortDate(r.endDate)}`;
}

function clock(time: string): string {
  const [h, m] = time.split(":").map(Number);
  return `${h % 12 === 0 ? 12 : h % 12}:${String(m).padStart(2, "0")} ${h < 12 ? "AM" : "PM"}`;
}

function timeText(r: CalendarExportRow): string {
  const e = r.event;
  if (e.all_day || !e.start_time || (e.start_time.startsWith("00:00") && e.end_time?.startsWith("23:59"))) return "All day";
  return e.end_time ? `${clock(e.start_time)} – ${clock(e.end_time)}` : clock(e.start_time);
}

function rgb(hex: string): [number, number, number] {
  const h = /^#[0-9a-f]{6}$/i.test(hex) ? hex : "#1a5490";
  return [parseInt(h.slice(1, 3), 16), parseInt(h.slice(3, 5), 16), parseInt(h.slice(5, 7), 16)];
}

/** The brand color mixed toward white -- for the month bands. */
function tint(hex: string, amount: number): [number, number, number] {
  return rgb(hex).map((c) => Math.round(c + (255 - c) * amount)) as [number, number, number];
}

/** jsPDF's built-in font only has Western European letters; anything
 * else -- Arabic, say -- prints as gibberish and spreads out the whole
 * line, so it becomes a "?". Curly quotes, dashes, bullets, the ellipsis
 * and the like are in the font and print as typed. */
const WESTERN_EXTRAS = new Set([
  0x20ac, 0x201a, 0x0192, 0x201e, 0x2026, 0x2020, 0x2021, 0x02c6, 0x2030, 0x0160, 0x2039, 0x0152, 0x017d, 0x2018,
  0x2019, 0x201c, 0x201d, 0x2022, 0x2013, 0x2014, 0x02dc, 0x2122, 0x0161, 0x203a, 0x0153, 0x017e, 0x0178,
]);
function printable(text: string): string {
  return Array.from(text, (ch) => {
    const code = ch.codePointAt(0)!;
    return code === 0x0a || (code >= 0x20 && code <= 0x7e) || (code >= 0xa0 && code <= 0xff) || WESTERN_EXTRAS.has(code) ? ch : "?";
  }).join("");
}

type Column = { title: string; width: number };

export function buildCalendarPdf(
  JsPDF: typeof JsPdf,
  {
    title,
    subtitle,
    rows,
    brandHex,
    exportedOn,
  }: { title: string; subtitle: string; rows: CalendarExportRow[]; brandHex: string; exportedOn: string },
): JsPdf {
  const doc = new JsPDF({ unit: "pt", format: "letter", orientation: "landscape" });
  const brand = rgb(brandHex);
  const columns: Column[] = [
    { title: "Date", width: 122 },
    { title: "Time", width: 100 },
    { title: "Event", width: 158 },
    { title: "Type", width: 90 },
    { title: "Details", width: 166 },
    { title: "Location", width: 84 },
  ];
  const tableW = columns.reduce((s, c) => s + c.width, 0);
  const left = (PAGE_W - tableW) / 2;
  const bottom = PAGE_H - MARGIN - 14;
  let y = 0;

  function header(first: boolean) {
    if (first) {
      doc.setFillColor(...brand);
      doc.rect(0, 0, PAGE_W, 62, "F");
      doc.setTextColor(255, 255, 255);
      doc.setFont("helvetica", "bold");
      doc.setFontSize(18);
      doc.text(printable(title), left, 32);
      doc.setFont("helvetica", "normal");
      doc.setFontSize(9.5);
      doc.text(printable(subtitle), left, 48, { maxWidth: tableW - 130 });
      doc.text(`Exported ${exportedOn}`, left + tableW, 32, { align: "right" });
      doc.text(`${rows.length} ${rows.length === 1 ? "entry" : "entries"}`, left + tableW, 48, { align: "right" });
      y = 80;
    } else {
      doc.setTextColor(...brand);
      doc.setFont("helvetica", "bold");
      doc.setFontSize(11);
      doc.text(printable(title), left, MARGIN);
      y = MARGIN + 12;
    }
    doc.setFillColor(...brand);
    doc.rect(left, y, tableW, 18, "F");
    doc.setTextColor(255, 255, 255);
    doc.setFont("helvetica", "bold");
    doc.setFontSize(FONT);
    let x = left;
    for (const c of columns) {
      doc.text(c.title, x + PAD, y + 12);
      x += c.width;
    }
    y += 18;
  }

  function monthBand(label: string) {
    doc.setFillColor(...tint(brandHex, 0.82));
    doc.rect(left, y, tableW, 18, "F");
    doc.setTextColor(...brand);
    doc.setFont("helvetica", "bold");
    doc.setFontSize(10);
    doc.text(label, left + PAD, y + 12.5);
    y += 18;
  }

  /** A new page carries on the month it broke in. */
  function newPage(continuedMonth: string | null) {
    doc.addPage();
    header(false);
    if (continuedMonth) monthBand(`${continuedMonth} (continued)`);
  }

  header(true);
  if (rows.length === 0) {
    doc.setTextColor(102, 102, 102);
    doc.setFont("helvetica", "italic");
    doc.text("No events match what was chosen.", left + PAD, y + 18);
  }

  let month = "";
  let stripe = false;
  for (const r of rows) {
    const p = parts(r.date);
    const monthKey = `${p.y}-${p.m}`;
    doc.setFont("helvetica", "normal");
    doc.setFontSize(FONT);
    const cells = [
      dateText(r),
      timeText(r),
      r.event.title,
      "",
      (r.event.description ?? "")
        .split("\n")
        .map((l) => l.trim())
        .filter(Boolean)
        .join("\n"),
      r.event.location ?? "",
    ].map((t, i) => (doc.splitTextToSize(printable(t), columns[i].width - PAD * 2) as string[]));
    doc.setFont("helvetica", "bold");
    cells[2] = doc.splitTextToSize(printable(r.event.title), columns[2].width - PAD * 2) as string[];
    const rowH = Math.max(...cells.map((c) => c.length), 1) * LINE + PAD * 2 - 2;

    const monthLabel = `${MONTH_NAMES[p.m - 1]} ${p.y}`;
    const newMonth = monthKey !== month;
    if (y + (newMonth ? 18 : 0) + rowH > bottom) {
      newPage(newMonth ? null : monthLabel);
      stripe = false;
    }
    if (newMonth) {
      month = monthKey;
      stripe = false;
      monthBand(monthLabel);
    }

    if (stripe) {
      doc.setFillColor(247, 248, 250);
      doc.rect(left, y, tableW, rowH, "F");
    }
    stripe = !stripe;

    let x = left;
    cells.forEach((lines, i) => {
      const col = columns[i];
      if (i === 3) {
        // The type as a chip in the calendar's own color for it.
        const color = EVENT_TYPE_COLORS[r.event.event_type].color;
        doc.setFont("helvetica", "bold");
        doc.setFontSize(7.5);
        const label = r.event.event_type;
        const w = Math.min(doc.getTextWidth(label) + 10, col.width - PAD * 2);
        doc.setFillColor(...rgb(color));
        doc.roundedRect(x + PAD, y + PAD - 1, w, 12, 3, 3, "F");
        doc.setTextColor(...rgb(contrastText(color)));
        doc.text(label, x + PAD + 5, y + PAD + 7.5);
      } else {
        doc.setFont("helvetica", i === 2 ? "bold" : "normal");
        doc.setFontSize(FONT);
        doc.setTextColor(i === 2 ? 34 : 60, i === 2 ? 34 : 60, i === 2 ? 34 : 60);
        lines.forEach((line, n) => doc.text(line, x + PAD, y + PAD + 7 + n * LINE));
      }
      x += col.width;
    });
    y += rowH;
    doc.setDrawColor(230, 230, 230);
    doc.setLineWidth(0.5);
    doc.line(left, y, left + tableW, y);
  }

  const pages = doc.getNumberOfPages();
  for (let i = 1; i <= pages; i++) {
    doc.setPage(i);
    doc.setFont("helvetica", "normal");
    doc.setFontSize(8);
    doc.setTextColor(150, 150, 150);
    doc.text(printable(title), left, PAGE_H - MARGIN + 6);
    doc.text(`Page ${i} of ${pages}`, left + tableW, PAGE_H - MARGIN + 6, { align: "right" });
  }
  return doc;
}
