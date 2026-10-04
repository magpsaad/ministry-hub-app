"use client";

import { useMemo, useState, useTransition } from "react";
import type { MemberBasic } from "@/lib/members";
import { addOutreachEntryAction } from "@/app/g/[groupId]/outreach/actions";
import { OutreachQuickActions } from "./OutreachQuickActions";

function nowLocalDatetime() {
  const d = new Date();
  d.setMinutes(d.getMinutes() - d.getTimezoneOffset());
  return d.toISOString().slice(0, 16);
}

type MemberFilter = "mine" | "all" | "unassigned";

/** REQUIREMENTS.md §6.6 -- the full Outreach tab's "+ Add Outreach Entry":
 * Member defaults to the current user's assigned members, with "show all"/
 * "show unassigned" toggles; Servant always prefills the current user
 * (addOutreachEntryAction ignores anything else regardless). */
export function AddOutreachEntryModal({
  groupId,
  members,
  currentUserId,
  currentUserName,
  memberLabel,
  onClose,
  onSaved,
}: {
  groupId: string;
  members: MemberBasic[];
  currentUserId: string;
  currentUserName: string;
  memberLabel: string;
  onClose: () => void;
  onSaved: () => void;
}) {
  const [memberFilter, setMemberFilter] = useState<MemberFilter>("mine");
  const [memberId, setMemberId] = useState("");
  const [occurredAt, setOccurredAt] = useState(nowLocalDatetime());
  const [type, setType] = useState("");
  const [notes, setNotes] = useState("");
  const [followUpDue, setFollowUpDue] = useState("");
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);

  const filteredMembers = useMemo(() => {
    if (memberFilter === "mine") return members.filter((m) => m.assigned_servant_id === currentUserId);
    if (memberFilter === "unassigned") return members.filter((m) => !m.assigned_servant_id);
    return members;
  }, [members, memberFilter, currentUserId]);

  function handleFilterChange(next: MemberFilter) {
    setMemberFilter(next);
    setMemberId("");
  }

  const selectedMember = members.find((m) => m.id === memberId) ?? null;

  function handleSave() {
    if (!memberId) {
      setError(`Please select a ${memberLabel.toLowerCase()}.`);
      return;
    }
    setError(null);
    startTransition(async () => {
      const result = await addOutreachEntryAction(groupId, {
        member_id: memberId,
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
          <h2 className="text-lg font-bold text-brand">New Outreach Entry</h2>
          <button onClick={onClose} className="text-[#999] hover:text-[#333] text-xl leading-none">
            ×
          </button>
        </div>

        {error && <div className="mb-3 rounded-md bg-[#f8d7da] text-[#721c24] text-sm px-3 py-2">{error}</div>}

        <div className="space-y-3 text-sm">
          <div>
            <label className="block font-semibold mb-1">{memberLabel}</label>
            <div className="flex gap-3 mb-1.5 text-xs text-[#333]">
              <label className="flex items-center gap-1">
                <input type="radio" checked={memberFilter === "mine"} onChange={() => handleFilterChange("mine")} />
                My Assigned
              </label>
              <label className="flex items-center gap-1">
                <input type="radio" checked={memberFilter === "all"} onChange={() => handleFilterChange("all")} />
                Show All
              </label>
              <label className="flex items-center gap-1">
                <input
                  type="radio"
                  checked={memberFilter === "unassigned"}
                  onChange={() => handleFilterChange("unassigned")}
                />
                Unassigned
              </label>
            </div>
            <select
              value={memberId}
              onChange={(e) => setMemberId(e.target.value)}
              className="w-full rounded-md border border-[#ddd] px-3 py-2 focus:border-brand focus:outline-none"
            >
              <option value="">Select {memberLabel.toLowerCase()}…</option>
              {filteredMembers.map((m) => (
                <option key={m.id} value={m.id}>
                  {m.full_name}
                </option>
              ))}
            </select>
          </div>
          <p>
            <span className="font-semibold">Servant:</span> {currentUserName}
          </p>
          <div>
            <label className="block font-semibold mb-1">Date &amp; Time</label>
            <input
              type="datetime-local"
              value={occurredAt}
              onChange={(e) => setOccurredAt(e.target.value)}
              className="w-full rounded-md border border-[#ddd] px-3 py-2 focus:border-brand focus:outline-none"
            />
          </div>
          <OutreachQuickActions
            memberId={memberId || null}
            memberName={selectedMember?.full_name ?? null}
            memberPhone={selectedMember?.phone}
            memberLabel={memberLabel}
            servantName={currentUserName}
            onType={setType}
            onError={setError}
          />
          <div>
            <label className="block font-semibold mb-1">Type</label>
            <input
              value={type}
              onChange={(e) => setType(e.target.value)}
              placeholder="Call, Text, WhatsApp, Visit, Email, etc."
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
