"use client";

import { useState, useTransition } from "react";
import type { OutreachEntryFull } from "@/lib/outreach";
import { updateOutreachEntryAction } from "@/app/g/[groupId]/outreach/actions";

function toLocalDatetime(iso: string) {
  const d = new Date(iso);
  d.setMinutes(d.getMinutes() - d.getTimezoneOffset());
  return d.toISOString().slice(0, 16);
}

/** RLS restricts writes to the entry's own creator regardless of what this
 * modal shows (REQUIREMENTS.md §6.6) -- the caller only renders the Edit
 * trigger for entries the current user created in the first place. */
export function EditOutreachEntryModal({
  groupId,
  entry,
  onClose,
  onSaved,
}: {
  groupId: string;
  entry: OutreachEntryFull;
  onClose: () => void;
  onSaved: () => void;
}) {
  const [occurredAt, setOccurredAt] = useState(toLocalDatetime(entry.occurred_at));
  const [type, setType] = useState(entry.type ?? "");
  const [notes, setNotes] = useState(entry.notes ?? "");
  const [followUpDue, setFollowUpDue] = useState(entry.follow_up_due ?? "");
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);

  function handleSave() {
    setError(null);
    startTransition(async () => {
      const result = await updateOutreachEntryAction(groupId, entry.id, {
        occurred_at: new Date(occurredAt).toISOString(),
        type: type || null,
        notes: notes || null,
        follow_up_due: followUpDue || null,
      });
      if (result.error) {
        setError(result.error);
        return;
      }
      onSaved();
      onClose();
    });
  }

  return (
    <div className="fixed inset-0 z-[60] flex items-center justify-center bg-black/50 p-4" onClick={onClose}>
      <div
        className="w-full max-w-md rounded-xl bg-white p-6 shadow-[0_10px_40px_rgba(0,0,0,0.2)]"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center justify-between border-b-2 border-[#f0f0f0] pb-3 mb-4">
          <h2 className="text-lg font-bold text-brand">Edit Outreach — {entry.member_name}</h2>
          <button onClick={onClose} className="text-[#999] hover:text-[#333] text-xl leading-none">
            ×
          </button>
        </div>

        {error && <div className="mb-3 rounded-md bg-[#f8d7da] text-[#721c24] text-sm px-3 py-2">{error}</div>}

        <div className="space-y-3 text-sm">
          <div>
            <label className="block font-semibold mb-1">Date &amp; Time</label>
            <input
              type="datetime-local"
              value={occurredAt}
              onChange={(e) => setOccurredAt(e.target.value)}
              className="w-full rounded-md border border-[#ddd] px-3 py-2 focus:border-brand focus:outline-none"
            />
          </div>
          <div>
            <label className="block font-semibold mb-1">Type</label>
            <input
              value={type}
              onChange={(e) => setType(e.target.value)}
              placeholder="Call, Visit, Text, Email, etc."
              className="w-full rounded-md border border-[#ddd] px-3 py-2 focus:border-brand focus:outline-none"
            />
          </div>
          <div>
            <label className="block font-semibold mb-1">Notes</label>
            <textarea
              value={notes}
              onChange={(e) => setNotes(e.target.value)}
              rows={3}
              className="w-full rounded-md border border-[#ddd] px-3 py-2 focus:border-brand focus:outline-none"
            />
          </div>
          <div>
            <label className="block font-semibold mb-1">Follow-Up Due (optional)</label>
            <input
              type="date"
              value={followUpDue}
              onChange={(e) => setFollowUpDue(e.target.value)}
              className="w-full rounded-md border border-[#ddd] px-3 py-2 focus:border-brand focus:outline-none"
            />
          </div>
        </div>

        <div className="mt-5 flex gap-2 border-t border-[#f0f0f0] pt-4">
          <button
            onClick={handleSave}
            disabled={pending}
            className="rounded-md bg-brand px-4 py-2 text-sm font-semibold text-white hover:bg-brand-dark disabled:opacity-60 shadow-[0_2px_4px_rgba(0,0,0,0.15)] transition-all hover:-translate-y-0.5 hover:shadow-[0_4px_8px_rgba(0,0,0,0.2)] active:translate-y-0 active:shadow-[0_1px_2px_rgba(0,0,0,0.15)]"
          >
            {pending ? "Saving…" : "Save"}
          </button>
          <button onClick={onClose} className="rounded-md bg-[#f0f0f0] px-4 py-2 text-sm font-semibold text-[#333] hover:bg-[#e0e0e0] shadow-[0_2px_4px_rgba(0,0,0,0.1)] transition-all hover:-translate-y-0.5 hover:shadow-[0_4px_8px_rgba(0,0,0,0.15)] active:translate-y-0 active:shadow-[0_1px_2px_rgba(0,0,0,0.1)]">
            Cancel
          </button>
        </div>
      </div>
    </div>
  );
}
