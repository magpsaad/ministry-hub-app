"use client";

import { useMemo, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import type { OutreachEntryFull } from "@/lib/outreach";
import type { MemberBasic } from "@/lib/members";
import type { ServantOption } from "@/lib/servants";
import { useMyAssigned } from "@/components/MyAssignedContext";
import { deleteOutreachEntryAction } from "@/app/g/[groupId]/outreach/actions";
import { PencilIcon, TrashIcon } from "@/components/icons";
import { AddOutreachEntryModal } from "./AddOutreachEntryModal";
import { EditOutreachEntryModal } from "./EditOutreachEntryModal";
import { DateFilterModal } from "./DateFilterModal";
import { dateKeyInZone, formatDateTimeInZone } from "@/lib/timezone";
import { useTimezone } from "@/components/TimezoneProvider";

/** REQUIREMENTS.md §6.6 -- full Outreach tab: search + filter (Member,
 * Servant, Date range, My Assigned List), "+ Add Outreach Entry", Edit/
 * Delete visible only on entries the current user created (RLS enforces
 * this regardless of the UI). Cards are historical records only -- no
 * quick-action links here (those live on the Add form instead, where an
 * action can actually be logged as a new entry). */
export function OutreachInteractive({
  groupId,
  entries,
  members,
  servants,
  memberLabel,
  currentUserId,
  currentUserName,
}: {
  groupId: string;
  entries: OutreachEntryFull[];
  members: MemberBasic[];
  servants: ServantOption[];
  memberLabel: string;
  currentUserId: string;
  currentUserName: string;
}) {
  const timeZone = useTimezone();
  const router = useRouter();
  const { myAssignedOnly, hydrated } = useMyAssigned();
  const [q, setQ] = useState("");
  const [memberId, setMemberId] = useState("");
  const [servantId, setServantId] = useState("");
  const [dateFrom, setDateFrom] = useState("");
  const [dateTo, setDateTo] = useState("");
  const [showDateFilter, setShowDateFilter] = useState(false);
  const [showAdd, setShowAdd] = useState(false);
  const [editingEntry, setEditingEntry] = useState<OutreachEntryFull | null>(null);
  const [pending, startTransition] = useTransition();

  const filtered = useMemo(() => {
    let result = entries;
    if (hydrated && myAssignedOnly) {
      result = result.filter((e) => e.assigned_servant_id === currentUserId);
    }
    if (q.trim()) {
      const needle = q.trim().toLowerCase();
      result = result.filter((e) => e.member_name.toLowerCase().includes(needle));
    }
    if (memberId) result = result.filter((e) => e.member_id === memberId);
    if (servantId) result = result.filter((e) => e.servant_id === servantId);
    if (dateFrom) result = result.filter((e) => dateKeyInZone(e.occurred_at, timeZone) >= dateFrom);
    if (dateTo) result = result.filter((e) => dateKeyInZone(e.occurred_at, timeZone) <= dateTo);
    return result;
  }, [entries, hydrated, myAssignedOnly, currentUserId, q, memberId, servantId, dateFrom, dateTo, timeZone]);

  function handleDelete(entry: OutreachEntryFull) {
    if (!confirm(`Delete this outreach entry for ${entry.member_name}?`)) return;
    startTransition(async () => {
      const result = await deleteOutreachEntryAction(groupId, entry.id);
      if (result.error) {
        alert(result.error);
        return;
      }
      router.refresh();
    });
  }

  const dateFilterActive = !!(dateFrom || dateTo);

  return (
    <div className="mt-4 space-y-4">
      <div className="flex flex-wrap items-center gap-2 justify-between">
        <div className="flex flex-wrap gap-2">
          <input
            type="text"
            value={q}
            onChange={(e) => setQ(e.target.value)}
            placeholder={`Search ${memberLabel.toLowerCase()}…`}
            className="rounded-md border border-[#ddd] px-3 py-2 text-sm focus:border-brand focus:outline-none focus:ring-2 focus:ring-brand/10"
          />
          <select
            value={memberId}
            onChange={(e) => setMemberId(e.target.value)}
            className="rounded-md border border-[#ddd] px-3 py-2 text-sm focus:border-brand focus:outline-none"
          >
            <option value="">All {memberLabel}s</option>
            {members.map((m) => (
              <option key={m.id} value={m.id}>
                {m.full_name}
              </option>
            ))}
          </select>
          <select
            value={servantId}
            onChange={(e) => setServantId(e.target.value)}
            className="rounded-md border border-[#ddd] px-3 py-2 text-sm focus:border-brand focus:outline-none"
          >
            <option value="">All Servants</option>
            {servants.map((s) => (
              <option key={s.id} value={s.id}>
                {s.full_name}
              </option>
            ))}
          </select>
          <button
            type="button"
            onClick={() => setShowDateFilter(true)}
            className="flex items-center gap-1 rounded-md border border-[#ddd] px-3 py-2 text-sm text-[#333] hover:bg-[#f5f5f5] shadow-[0_2px_4px_rgba(0,0,0,0.1)] transition-all hover:-translate-y-0.5 hover:shadow-[0_4px_8px_rgba(0,0,0,0.15)] active:translate-y-0 active:shadow-[0_1px_2px_rgba(0,0,0,0.1)]"
          >
            Date Filter
            {dateFilterActive && (
              <span className="rounded-full bg-brand text-white text-[10px] px-1.5 py-0.5">1</span>
            )}
            <span className="text-[#999]">▾</span>
          </button>
        </div>
        <button
          type="button"
          onClick={() => setShowAdd(true)}
          className="rounded-md bg-brand px-4 py-2 text-sm font-semibold text-white hover:bg-brand-dark shadow-[0_2px_4px_rgba(0,0,0,0.15)] transition-all hover:-translate-y-0.5 hover:shadow-[0_4px_8px_rgba(0,0,0,0.2)] active:translate-y-0 active:shadow-[0_1px_2px_rgba(0,0,0,0.15)]"
        >
          + Add Outreach Entry
        </button>
      </div>

      <div className="space-y-2">
        {filtered.map((entry) => {
          const canEdit = entry.servant_id === currentUserId;
          return (
            <div key={entry.id} className="rounded-xl bg-white shadow-[0_4px_20px_rgba(0,0,0,0.06)] p-4">
              {/* flex-wrap here let the Edit/Delete buttons drop to a new
                  line (left-aligned) whenever the text content was long
                  enough to want to wrap -- owner-reported. Plain flex
                  (no wrap) forces the text column (already min-w-0) to
                  shrink and wrap its own text internally instead, keeping
                  the buttons pinned on the same row via justify-between. */}
              <div className="flex items-start justify-between gap-2">
                <div className="min-w-0">
                  <p className="font-semibold text-brand">
                    {entry.member_name}
                    {entry.type ? ` — ${entry.type}` : ""}
                  </p>
                  <p className="text-xs text-[#666]">
                    {formatDateTimeInZone(entry.occurred_at, timeZone, { dateStyle: "medium", timeStyle: "short" })}{" "}
                    · By {entry.servant_name}
                  </p>
                  {entry.notes && <p className="mt-1 text-sm text-[#333] break-words">{entry.notes}</p>}
                  {entry.follow_up_due && (
                    <p className="mt-1 text-xs text-[#856404]">Follow-up due {entry.follow_up_due}</p>
                  )}
                </div>
                {canEdit && (
                  <div className="shrink-0 flex items-center gap-2">
                    <button
                      type="button"
                      onClick={() => setEditingEntry(entry)}
                      title="Edit"
                      className="flex items-center gap-1 rounded-md bg-[#f0f0f0] px-3 py-1.5 text-xs font-semibold text-[#333] hover:bg-[#e0e0e0]"
                    >
                      <PencilIcon className="h-3.5 w-3.5" />
                      Edit
                    </button>
                    <button
                      type="button"
                      onClick={() => handleDelete(entry)}
                      disabled={pending}
                      title="Delete"
                      className="flex items-center gap-1 rounded-md bg-[#f0f0f0] px-3 py-1.5 text-xs font-semibold text-[#dc3545] hover:bg-[#f8d7da] disabled:opacity-60"
                    >
                      <TrashIcon className="h-3.5 w-3.5" />
                      Delete
                    </button>
                  </div>
                )}
              </div>
            </div>
          );
        })}
        {filtered.length === 0 && (
          <p className="text-center text-sm text-[#666] py-6">No outreach entries match these filters.</p>
        )}
      </div>

      {showDateFilter && (
        <DateFilterModal
          dateFrom={dateFrom}
          dateTo={dateTo}
          onApply={(from, to) => {
            setDateFrom(from);
            setDateTo(to);
            setShowDateFilter(false);
          }}
          onClose={() => setShowDateFilter(false)}
        />
      )}
      {showAdd && (
        <AddOutreachEntryModal
          groupId={groupId}
          members={members}
          currentUserId={currentUserId}
          currentUserName={currentUserName}
          memberLabel={memberLabel}
          onClose={() => setShowAdd(false)}
          onSaved={() => router.refresh()}
        />
      )}
      {editingEntry && (
        <EditOutreachEntryModal
          groupId={groupId}
          entry={editingEntry}
          onClose={() => setEditingEntry(null)}
          onSaved={() => router.refresh()}
        />
      )}
    </div>
  );
}
