"use client";

import { useState } from "react";

/** Small modal behind the Outreach tab's "Date Filter" control -- replaces
 * two always-visible date inputs with a single dropdown-styled button. */
export function DateFilterModal({
  dateFrom,
  dateTo,
  onApply,
  onClose,
}: {
  dateFrom: string;
  dateTo: string;
  onApply: (from: string, to: string) => void;
  onClose: () => void;
}) {
  const [from, setFrom] = useState(dateFrom);
  const [to, setTo] = useState(dateTo);

  return (
    <div className="fixed inset-0 z-[70] flex items-center justify-center bg-black/50 p-4" onClick={onClose}>
      <div
        className="w-full max-w-xs rounded-xl bg-white p-5 shadow-[0_10px_40px_rgba(0,0,0,0.2)]"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center justify-between border-b-2 border-[#f0f0f0] pb-3 mb-4">
          <h2 className="text-base font-bold text-brand">Date Filter</h2>
          <button onClick={onClose} className="text-[#999] hover:text-[#333] text-xl leading-none">
            ×
          </button>
        </div>
        <div className="space-y-3 text-sm">
          <div>
            <label className="block font-semibold mb-1">From</label>
            <input
              type="date"
              value={from}
              onChange={(e) => setFrom(e.target.value)}
              className="w-full rounded-md border border-[#ddd] px-3 py-2 focus:border-brand focus:outline-none"
            />
          </div>
          <div>
            <label className="block font-semibold mb-1">To</label>
            <input
              type="date"
              value={to}
              onChange={(e) => setTo(e.target.value)}
              className="w-full rounded-md border border-[#ddd] px-3 py-2 focus:border-brand focus:outline-none"
            />
          </div>
        </div>
        <div className="mt-5 flex gap-2 border-t border-[#f0f0f0] pt-4">
          <button
            onClick={() => onApply(from, to)}
            className="rounded-md bg-brand px-4 py-2 text-sm font-semibold text-white hover:bg-brand-dark shadow-[0_2px_4px_rgba(0,0,0,0.15)] transition-all hover:-translate-y-0.5 hover:shadow-[0_4px_8px_rgba(0,0,0,0.2)] active:translate-y-0 active:shadow-[0_1px_2px_rgba(0,0,0,0.15)]"
          >
            Apply
          </button>
          <button
            onClick={() => onApply("", "")}
            className="rounded-md bg-[#f0f0f0] px-4 py-2 text-sm font-semibold text-[#333] hover:bg-[#e0e0e0] shadow-[0_2px_4px_rgba(0,0,0,0.1)] transition-all hover:-translate-y-0.5 hover:shadow-[0_4px_8px_rgba(0,0,0,0.15)] active:translate-y-0 active:shadow-[0_1px_2px_rgba(0,0,0,0.1)]"
          >
            Clear
          </button>
        </div>
      </div>
    </div>
  );
}
