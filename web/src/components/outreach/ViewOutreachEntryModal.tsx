"use client";

import type { OutreachEntryFull } from "@/lib/outreach";
import { formatDateTimeInZone } from "@/lib/timezone";
import { useTimezone } from "@/components/TimezoneProvider";

/** REQUIREMENTS.md §6.3/§7.1 -- read-only reminder of what a past outreach
 * entry actually said, opened from a Follow-up Due Actions Needed card's
 * "View original entry" link. Deliberately not editable here -- editing
 * belongs to EditOutreachEntryModal on the Outreach tab, restricted to the
 * entry's own creator by RLS; this is just a reminder popup. */
export function ViewOutreachEntryModal({
  entry,
  onClose,
}: {
  entry: OutreachEntryFull;
  onClose: () => void;
}) {
  const timeZone = useTimezone();
  return (
    <div className="fixed inset-0 z-[60] flex items-center justify-center bg-black/50 p-4" onClick={onClose}>
      <div
        className="w-full max-w-md rounded-xl bg-white p-6 shadow-[0_10px_40px_rgba(0,0,0,0.2)]"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center justify-between border-b-2 border-[#f0f0f0] pb-3 mb-4">
          <h2 className="text-lg font-bold text-brand">Outreach Entry — {entry.member_name}</h2>
          <button onClick={onClose} className="text-[#999] hover:text-[#333] text-xl leading-none">
            ×
          </button>
        </div>

        <div className="space-y-3 text-sm">
          <p>
            <span className="font-semibold">By:</span> {entry.servant_name}
          </p>
          <p>
            <span className="font-semibold">Date &amp; Time:</span>{" "}
            {formatDateTimeInZone(entry.occurred_at, timeZone, { dateStyle: "medium", timeStyle: "short" })}
          </p>
          <p>
            <span className="font-semibold">Type:</span> {entry.type ?? "—"}
          </p>
          <div>
            <p className="font-semibold">Notes:</p>
            <p className="mt-1 whitespace-pre-wrap text-[#333]">{entry.notes || "—"}</p>
          </div>
          {entry.follow_up_due && (
            <p>
              <span className="font-semibold">Follow-Up Due:</span> {entry.follow_up_due}
            </p>
          )}
        </div>

        <div className="mt-5 flex gap-2 border-t border-[#f0f0f0] pt-4">
          <button onClick={onClose} className="rounded-md bg-[#f0f0f0] px-4 py-2 text-sm font-semibold text-[#333] hover:bg-[#e0e0e0] shadow-[0_2px_4px_rgba(0,0,0,0.1)] transition-all hover:-translate-y-0.5 hover:shadow-[0_4px_8px_rgba(0,0,0,0.15)] active:translate-y-0 active:shadow-[0_1px_2px_rgba(0,0,0,0.1)]">
            Close
          </button>
        </div>
      </div>
    </div>
  );
}
