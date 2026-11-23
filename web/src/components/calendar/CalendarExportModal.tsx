"use client";

import { useMemo, useState } from "react";
import type { CalendarEvent, CalendarEventType } from "@/lib/calendar-types";
import { EVENT_TYPES } from "@/lib/calendar-types";
import { calendarExportCsv, calendarExportRows, calendarExportRowsByType } from "@/lib/calendar-export";

/** Owner-requested (22 Nov 2026): export the Service Calendar's events as a
 * CSV list -- the event types to include, and every day or only the service
 * day (Fridays). See lib/calendar-export.ts for the rows and columns. */
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

  const rowsByType = useMemo(
    () => calendarExportRowsByType(events, serviceDayOnly, serviceWeekday),
    [events, serviceDayOnly, serviceWeekday],
  );
  const rows = calendarExportRows(rowsByType, types);

  function toggle(t: CalendarEventType) {
    setTypes((prev) => {
      const next = new Set(prev);
      if (next.has(t)) next.delete(t);
      else next.add(t);
      return next;
    });
  }

  function handleDownload() {
    const csv = calendarExportCsv(rows, serviceDayOnly);
    const url = URL.createObjectURL(new Blob([csv], { type: "text/csv;charset=utf-8;" }));
    const a = document.createElement("a");
    a.href = url;
    a.download = `${fileTitle} - ${serviceDayOnly ? serviceWeekdayLabel : "All days"}.csv`;
    document.body.appendChild(a);
    a.click();
    a.remove();
    URL.revokeObjectURL(url);
    onClose();
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

          <p className="text-xs text-[#666]">
            {rows.length === 0
              ? "Nothing to export. Choose at least one event type that has events."
              : `${rows.length} row${rows.length === 1 ? "" : "s"}: date, time, event, type, details (speaker, topic, leader) and location.`}
          </p>
        </div>

        <div className="mt-5 flex gap-2">
          <button
            onClick={handleDownload}
            disabled={rows.length === 0}
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
