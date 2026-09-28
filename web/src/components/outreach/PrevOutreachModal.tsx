"use client";

import { useEffect, useState } from "react";
import { getMemberOutreachAction } from "@/app/g/[groupId]/outreach/actions";
import type { OutreachEntry } from "@/lib/outreach";
import { formatDateTimeInZone } from "@/lib/timezone";
import { useTimezone } from "@/components/TimezoneProvider";

export function PrevOutreachModal({
  memberId,
  memberName,
  onClose,
}: {
  memberId: string;
  memberName: string;
  onClose: () => void;
}) {
  const timeZone = useTimezone();
  const [entries, setEntries] = useState<OutreachEntry[] | null>(null);

  useEffect(() => {
    getMemberOutreachAction(memberId).then(setEntries);
  }, [memberId]);

  return (
    <div className="fixed inset-0 z-[60] flex items-center justify-center bg-black/50 p-4" onClick={onClose}>
      <div
        className="w-full max-w-md max-h-[80vh] overflow-y-auto rounded-xl bg-white p-6 shadow-[0_10px_40px_rgba(0,0,0,0.2)]"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center justify-between border-b-2 border-[#f0f0f0] pb-3 mb-4">
          <h2 className="text-lg font-bold text-brand">Prev. Outreach — {memberName}</h2>
          <button onClick={onClose} className="text-[#999] hover:text-[#333] text-xl leading-none">
            ×
          </button>
        </div>

        {entries === null ? (
          <p className="text-sm text-[#666]">Loading…</p>
        ) : entries.length === 0 ? (
          <p className="text-sm text-[#666]">No outreach entries recorded yet.</p>
        ) : (
          <ul className="space-y-3">
            {entries.map((e) => (
              <li key={e.id} className="rounded-md border border-[#eee] p-3 text-sm">
                <p className="font-semibold text-brand">
                  {formatDateTimeInZone(e.occurred_at, timeZone, { dateStyle: "medium", timeStyle: "short" })}
                  {e.type ? ` — ${e.type}` : ""}
                </p>
                <p className="text-xs text-[#666]">By {e.servant?.full_name ?? "Unknown"}</p>
                {e.notes && <p className="mt-1 text-[#333]">{e.notes}</p>}
                {e.follow_up_due && (
                  <p className="mt-1 text-xs text-[#856404]">Follow-up due {e.follow_up_due}</p>
                )}
              </li>
            ))}
          </ul>
        )}
      </div>
    </div>
  );
}
