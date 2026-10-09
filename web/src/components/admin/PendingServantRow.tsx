"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import type { PendingServant } from "@/lib/pending-servants";
import { approvePendingServantAction, removePendingServantAction } from "@/app/admin/pending-servants/actions";
import { BusyLabel } from "@/components/PendingButton";
import { useTimezone } from "@/components/TimezoneProvider";
import { formatDateTimeInZone } from "@/lib/timezone";

/** One registration on Pending Servants. Owner-requested (9 Oct 2026): one
 * line -- name and status -- that opens to the full details and buttons
 * when tapped. */
export function PendingServantRow({ servant }: { servant: PendingServant }) {
  const timeZone = useTimezone();
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [open, setOpen] = useState(false);
  const [approved, setApproved] = useState(!!servant.approved_at);
  // Migration 0108: approved, not fully onboarded yet.
  const stage = servant.stage ?? (approved ? "not_opened" : null);
  const [removed, setRemoved] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const status = !approved
    ? "Waiting for approval"
    : stage === "agreement"
      ? "Opened the app – agreement not signed yet"
      : "Approved – hasn't opened the app yet";
  // On a phone the full wording leaves almost no room for the name.
  const shortStatus = !approved ? status : stage === "agreement" ? "Agreement not signed yet" : "Hasn't opened the app yet";

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
    <div>
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        aria-expanded={open}
        className="flex w-full items-center gap-2 px-4 py-3 text-left hover:bg-[#fafafa]"
      >
        <span aria-hidden="true" className="shrink-0 text-[10px] text-[#999]">
          {open ? "▼" : "▶"}
        </span>
        <span className="min-w-0 flex-1 overflow-hidden whitespace-nowrap text-clip text-sm font-semibold text-brand">
          {servant.full_name}
        </span>
        <span className={`shrink-0 text-xs ${approved ? "text-[#777]" : "font-semibold text-[#8a6d00]"}`}>
          <span className="sm:hidden">{shortStatus}</span>
          <span className="hidden sm:inline">{status}</span>
        </span>
      </button>

      {open && (
        <div className="flex flex-wrap items-center justify-between gap-3 px-4 pb-4 pl-8">
          <div className="min-w-0">
            <p className="text-xs text-[#666]">
              {servant.phone ?? "—"} · {servant.email ?? "—"} · {servant.gender ?? "—"}
            </p>
            {servant.father_of_confession && (
              <p className="text-xs text-[#666]">Father of Confession: {servant.father_of_confession}</p>
            )}
            {servant.registration_comments && (
              <p className="text-xs text-[#666] italic">&ldquo;{servant.registration_comments}&rdquo;</p>
            )}
            <p className="text-xs text-[#999] mt-1">
              First registered {formatDateTimeInZone(servant.submitted_at, timeZone, { year: "numeric", month: "short", day: "numeric" })} ·
              checked in {servant.checkInCount} time{servant.checkInCount === 1 ? "" : "s"}
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
          {!approved && (
            <div className="shrink-0 flex items-center gap-2">
              <button
                type="button"
                onClick={handleApprove}
                disabled={pending}
                className="rounded-md bg-brand px-4 py-2 text-sm font-semibold text-white hover:bg-brand-dark disabled:opacity-60 shadow-[0_2px_4px_rgba(0,0,0,0.15)]"
              >
                <BusyLabel busy={pending} busyText="Approving…">
                  Approve
                </BusyLabel>
              </button>
              <button
                type="button"
                onClick={handleRemove}
                disabled={pending}
                className="rounded-md bg-[#f0f0f0] px-3 py-2 text-sm font-semibold text-[#dc3545] hover:bg-[#f8d7da] disabled:opacity-60 shadow-[0_2px_4px_rgba(0,0,0,0.1)]"
              >
                Remove
              </button>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
