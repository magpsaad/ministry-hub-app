"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import type { PendingServant } from "@/lib/pending-servants";
import { approvePendingServantAction, removePendingServantAction } from "@/app/admin/pending-servants/actions";
import { useTimezone } from "@/components/TimezoneProvider";
import { formatDateTimeInZone } from "@/lib/timezone";

export function PendingServantRow({ servant }: { servant: PendingServant }) {
  const timeZone = useTimezone();
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [approved, setApproved] = useState(!!servant.approved_at);
  // Migration 0108: approved, not fully onboarded yet.
  const stage = servant.stage ?? (approved ? "not_opened" : null);
  const [removed, setRemoved] = useState(false);
  const [error, setError] = useState<string | null>(null);

  function handleApprove() {
    setError(null);
    startTransition(async () => {
      const result = await approvePendingServantAction(servant.id);
      if (result.error) {
        setError(result.error);
        return;
      }
      setApproved(true);
      router.refresh();
    });
  }

  function handleRemove() {
    if (!confirm(`Remove ${servant.full_name}'s pending registration? This cannot be undone.`)) return;
    setError(null);
    startTransition(async () => {
      const result = await removePendingServantAction(servant.id);
      if (result.error) {
        setError(result.error);
        return;
      }
      setRemoved(true);
    });
  }

  if (removed) return null;

  return (
    <div className="rounded-xl bg-white shadow-[0_4px_20px_rgba(0,0,0,0.06)] p-4 flex flex-wrap items-center justify-between gap-3">
      <div className="min-w-0">
        <p className="font-semibold text-brand">{servant.full_name}</p>
        <p className="text-xs text-[#666]">
          {servant.phone ?? "—"} · {servant.email ?? "—"} · {servant.gender ?? "—"}
        </p>
        {servant.father_of_confession && (
          <p className="text-xs text-[#666]">Father of Confession: {servant.father_of_confession}</p>
        )}
        {servant.registration_comments && <p className="text-xs text-[#666] italic">&ldquo;{servant.registration_comments}&rdquo;</p>}
        <p className="text-xs text-[#999] mt-1">
          First registered {formatDateTimeInZone(servant.submitted_at, timeZone, { year: "numeric", month: "short", day: "numeric" })} · checked in {servant.checkInCount}{" "}
          time{servant.checkInCount === 1 ? "" : "s"}
        </p>
        {approved && (
          <p className="text-xs text-[#888] mt-1">
            {servant.approved_at
              ? `Approved ${formatDateTimeInZone(servant.approved_at, timeZone, { month: "short", day: "numeric" })}${servant.approved_by_name ? ` by ${servant.approved_by_name}` : ""}. `
              : "Approved. "}
            {stage === "agreement"
              ? "They'll leave this list once they sign the Confidentiality Agreement."
              : "They'll leave this list the first time they open the app."}
          </p>
        )}
        {error && <p className="text-xs text-[#dc3545] mt-1">{error}</p>}
      </div>
      <div className="shrink-0 flex items-center gap-2">
        {approved ? (
          // Owner-chosen wording (9 Oct 2026): subtle, not a call to action.
          <span className="rounded-full bg-[#f0f0f0] text-[#555] text-xs font-semibold px-3 py-1.5">
            {stage === "agreement" ? "Opened the app – agreement not signed yet" : "Approved – hasn't opened the app yet"}
          </span>
        ) : (
          <button
            type="button"
            onClick={handleApprove}
            disabled={pending}
            className="rounded-md bg-brand px-4 py-2 text-sm font-semibold text-white hover:bg-brand-dark disabled:opacity-60 shadow-[0_2px_4px_rgba(0,0,0,0.15)] transition-all hover:-translate-y-0.5 hover:shadow-[0_4px_8px_rgba(0,0,0,0.2)] active:translate-y-0 active:shadow-[0_1px_2px_rgba(0,0,0,0.15)]"
          >
            {pending ? "Approving…" : "Approve"}
          </button>
        )}
        {!approved && (
        <button
          type="button"
          onClick={handleRemove}
          disabled={pending}
          className="rounded-md bg-[#f0f0f0] px-3 py-2 text-sm font-semibold text-[#dc3545] hover:bg-[#f8d7da] disabled:opacity-60 shadow-[0_2px_4px_rgba(0,0,0,0.1)] transition-all hover:-translate-y-0.5 hover:shadow-[0_4px_8px_rgba(0,0,0,0.15)] active:translate-y-0 active:shadow-[0_1px_2px_rgba(0,0,0,0.1)]"
        >
          Remove
        </button>
        )}
      </div>
    </div>
  );
}
