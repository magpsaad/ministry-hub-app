"use client";

import { useMemo, useState } from "react";
import type { CalendarEvent, CalendarEventType } from "@/lib/calendar-types";
import { EVENT_TYPES } from "@/lib/calendar-types";
import { calendarExportCsv, calendarExportRows, calendarExportRowsByType } from "@/lib/calendar-export";
import { buildCalendarPdf, longDate } from "@/lib/calendar-export-pdf";
import { BusyLabel } from "@/components/PendingButton";
import { useTimezone } from "@/components/TimezoneProvider";
import { todayInZone } from "@/lib/timezone";

type DateChoice = "all" | "future" | "range";

// Owner-reported (10 Oct 2026, the event form): a phone's date boxes have a
// built-in minimum width, so they're allowed to shrink to their half.
const dateClass =
  "block w-full min-w-0 appearance-none rounded-md border border-[#ddd] bg-white px-3 py-2 text-sm focus:border-brand focus:outline-none focus:ring-2 focus:ring-brand/10";

/** Owner-requested (22 Nov 2026): export the Service Calendar's events as a
 * CSV list -- the event types to include, and every day or only the service
 * day (Fridays); and all dates, future events only (from today) or a date
 * range -- as a CSV or (owner-requested the same day) a formatted PDF. See
 * lib/calendar-export.ts and lib/calendar-export-pdf.ts. */
export function CalendarExportModal({
  events,
  serviceWeekday,
  serviceWeekdayLabel,
  fileTitle,
  onClose,
}: {
  events: CalendarEvent[];
  serviceWeekday: number;
  serviceWeekdayLabel: string;
  fileTitle: string;
  onClose: () => void;
}) {
  const [types, setTypes] = useState<Set<CalendarEventType>>(new Set(EVENT_TYPES));
  const [serviceDayOnly, setServiceDayOnly] = useState(false);
  const [dateChoice, setDateChoice] = useState<DateChoice>("all");
  const [rangeFrom, setRangeFrom] = useState("");
  const [rangeTo, setRangeTo] = useState("");
  const today = todayInZone(useTimezone());

  const from = dateChoice === "future" ? today : dateChoice === "range" ? rangeFrom || null : null;
  const to = dateChoice === "range" ? rangeTo || null : null;
  const badRange = !!from && !!to && from > to;

  const rowsByType = useMemo(
    () => calendarExportRowsByType(events, serviceDayOnly, serviceWeekday, from, badRange ? from : to),
    [events, serviceDayOnly, serviceWeekday, from, to, badRange],
  );
  const rows = badRange ? [] : calendarExportRows(rowsByType, types);
  const [makingPdf, setMakingPdf] = useState(false);
  const [pdfError, setPdfError] = useState<string | null>(null);

  const daysText = serviceDayOnly ? `${serviceWeekdayLabel} only` : "All days";
  const datesSuffix = from && to ? ` - ${from} to ${to}` : from ? ` - from ${from}` : to ? ` - to ${to}` : "";
  const fileName = `${fileTitle} - ${serviceDayOnly ? serviceWeekdayLabel : "All days"}${datesSuffix}`;

  function save(blob: Blob, name: string) {
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = name;
    document.body.appendChild(a);
    a.click();
    a.remove();
    URL.revokeObjectURL(url);
  }

  function toggle(t: CalendarEventType) {
    setTypes((prev) => {
      const next = new Set(prev);
      if (next.has(t)) next.delete(t);
      else next.add(t);
      return next;
    });
  }

  function handleDownload() {
    save(new Blob([calendarExportCsv(rows, serviceDayOnly)], { type: "text/csv;charset=utf-8;" }), `${fileName}.csv`);
    onClose();
  }

  async function handleDownloadPdf(button: HTMLElement) {
    setMakingPdf(true);
    setPdfError(null);
    try {
      // Loaded only when someone asks for a PDF, like Export Lists.
      const { jsPDF } = await import("jspdf");
      const dates =
        from && to
          ? `${longDate(from)} to ${longDate(to)}`
          : from
            ? dateChoice === "future"
              ? `future events from ${longDate(from)}`
              : `from ${longDate(from)}`
            : to
              ? `up to ${longDate(to)}`
              : "all dates";
      const typeList = types.size === EVENT_TYPES.length ? "all" : EVENT_TYPES.filter((t) => types.has(t)).join(", ");
      const doc = buildCalendarPdf(jsPDF, {
        title: fileTitle,
        subtitle: `${daysText}, ${dates}. Types: ${typeList}`,
        rows,
        // The ministry's own color, as the page shows it.
        brandHex: getComputedStyle(button).getPropertyValue("--brand").trim(),
        exportedOn: longDate(today),
      });
      save(doc.output("blob"), `${fileName}.pdf`);
      onClose();
    } catch {
      setPdfError("Couldn't make the PDF. Please try again.");
      setMakingPdf(false);
    }
  }

  const choiceClass = "h-4 w-4 accent-brand";

  return (
    <div className="fixed inset-0 z-[80] flex items-center justify-center bg-black/50 p-4" onClick={onClose}>
      <div
        className="w-full max-w-md max-h-[90vh] overflow-y-auto rounded-xl bg-white p-6 shadow-[0_10px_40px_rgba(0,0,0,0.2)]"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center justify-between border-b-2 border-[#f0f0f0] pb-3 mb-4">
          <h2 className="text-lg font-bold text-brand">Export Events</h2>
          <button onClick={onClose} className="text-[#999] hover:text-[#333] text-xl leading-none">
            ×
          </button>
        </div>

        <div className="space-y-4 text-sm">
          <div>
            <div className="flex items-center justify-between mb-1">
              <span className="font-semibold">Event types</span>
              <button
                type="button"
                onClick={() => setTypes(types.size === EVENT_TYPES.length ? new Set() : new Set(EVENT_TYPES))}
                className="text-xs font-semibold text-brand hover:underline"
              >
                {types.size === EVENT_TYPES.length ? "Clear all" : "Select all"}
              </button>
            </div>
            <div className="space-y-1.5">
              {EVENT_TYPES.map((t) => (
                <label key={t} className="flex items-center gap-2 cursor-pointer">
                  <input type="checkbox" checked={types.has(t)} onChange={() => toggle(t)} className={choiceClass} />
                  <span className="flex-1">{t}</span>
                  <span className="text-xs text-[#999]">{rowsByType.get(t)?.length ?? 0}</span>
                </label>
              ))}
            </div>
          </div>

          <div>
            <span className="block font-semibold mb-1">Days</span>
            <div className="space-y-1.5">
              <label className="flex items-center gap-2 cursor-pointer">
                <input type="radio" name="export-days" checked={!serviceDayOnly} onChange={() => setServiceDayOnly(false)} className={choiceClass} />
                All days
              </label>
              <label className="flex items-center gap-2 cursor-pointer">
                <input type="radio" name="export-days" checked={serviceDayOnly} onChange={() => setServiceDayOnly(true)} className={choiceClass} />
                {serviceWeekdayLabel} only
              </label>
            </div>
          </div>

          <div>
            <span className="block font-semibold mb-1">Dates</span>
            <div className="space-y-1.5">
              {(
                [
                  ["all", "All dates"],
                  ["future", "Future events only (from today)"],
                  ["range", "Date range"],
                ] as [DateChoice, string][]
              ).map(([value, label]) => (
                <label key={value} className="flex items-center gap-2 cursor-pointer">
                  <input
                    type="radio"
                    name="export-dates"
                    checked={dateChoice === value}
                    onChange={() => setDateChoice(value)}
                    className={choiceClass}
                  />
                  {label}
                </label>
              ))}
            </div>
            {dateChoice === "range" && (
              <div className="mt-2 grid grid-cols-2 gap-2">
                <label className="min-w-0">
                  <span className="block text-xs text-[#666] mb-0.5">From</span>
                  <input type="date" value={rangeFrom} onChange={(e) => setRangeFrom(e.target.value)} className={dateClass} />
                </label>
                <label className="min-w-0">
                  <span className="block text-xs text-[#666] mb-0.5">To</span>
                  <input type="date" value={rangeTo} onChange={(e) => setRangeTo(e.target.value)} className={dateClass} />
                </label>
              </div>
            )}
          </div>

          <p className="text-xs text-[#666]">
            {badRange
              ? "The From date is after the To date."
              : rows.length === 0
              ? "Nothing to export. Choose at least one event type that has events."
              : `${rows.length} row${rows.length === 1 ? "" : "s"}: date, time, event, type, details (speaker, topic, leader) and location.`}
          </p>
        </div>

        {pdfError && <div className="mt-3 rounded-md bg-[#f8d7da] text-[#721c24] text-sm px-3 py-2">{pdfError}</div>}

        <div className="mt-5 flex flex-wrap gap-2">
          <button
            onClick={(e) => handleDownloadPdf(e.currentTarget)}
            disabled={rows.length === 0 || makingPdf}
            className="rounded-md bg-brand px-4 py-2 text-sm font-semibold text-white hover:bg-brand-dark disabled:opacity-60 shadow-[0_2px_4px_rgba(0,0,0,0.15)] transition-all hover:-translate-y-0.5 hover:shadow-[0_4px_8px_rgba(0,0,0,0.2)] active:translate-y-0 active:shadow-[0_1px_2px_rgba(0,0,0,0.15)]"
          >
            <BusyLabel busy={makingPdf} busyText="Making PDF">
              Download PDF
            </BusyLabel>
          </button>
          <button
            onClick={handleDownload}
            disabled={rows.length === 0 || makingPdf}
            className="rounded-md bg-brand px-4 py-2 text-sm font-semibold text-white hover:bg-brand-dark disabled:opacity-60 shadow-[0_2px_4px_rgba(0,0,0,0.15)] transition-all hover:-translate-y-0.5 hover:shadow-[0_4px_8px_rgba(0,0,0,0.2)] active:translate-y-0 active:shadow-[0_1px_2px_rgba(0,0,0,0.15)]"
          >
            Download CSV
          </button>
          <button onClick={onClose} className="rounded-md bg-[#f0f0f0] px-4 py-2 text-sm font-semibold text-[#333] hover:bg-[#e0e0e0] shadow-[0_2px_4px_rgba(0,0,0,0.1)] transition-all hover:-translate-y-0.5 hover:shadow-[0_4px_8px_rgba(0,0,0,0.15)] active:translate-y-0 active:shadow-[0_1px_2px_rgba(0,0,0,0.1)]">
            Cancel
          </button>
        </div>
      </div>
    </div>
  );
}
