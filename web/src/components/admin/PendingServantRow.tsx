"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import type { PendingServant } from "@/lib/pending-servants";
import { approvePendingServantAction, removePendingServantAction } from "@/app/admin/pending-servants/actions";
import { BusyLabel } from "@/components/PendingButton";
import { useTimezone } from "@/components/TimezoneProvider";
import { formatDateTimeInZone } from "@/lib/timezone";

/** One registration on Pending Servants. Owner-requested (9 Oct 2026): a
 * compact card -- the name (with Approve / Remove beside it while it waits
 * for approval, or on their own line when they don't fit), then the full
 * status; tapping the card opens all the details. */
export function PendingServantRow({ servant }: { servant: PendingServant }) {
  const timeZone = useTimezone();
  const router = useRouter();
  const [busy, startTransition] = useTransition();
  const [action, setAction] = useState<"approve" | "remove" | null>(null);
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

  function handleApprove() {
    setError(null);
    setAction("approve");
    startTransition(async () => {
      const result = await approvePendingServantAction(servant.id);
      if (result.error) {
        setError(result.error);
        setAction(null);
        return;
      }
      setApproved(true);
      setAction(null);
      router.refresh();
    });
  }

  function handleRemove() {
    if (!confirm(`Remove ${servant.full_name}'s pending registration? This cannot be undone.`)) return;
    setError(null);
    setAction("remove");
    startTransition(async () => {
      const result = await removePendingServantAction(servant.id);
      if (result.error) {
        setError(result.error);
        setAction(null);
        return;
      }
      setRemoved(true);
    });
  }

  if (removed) return null;

  return (
    <div
      role="button"
      tabIndex={0}
      aria-expanded={open}
      onClick={() => setOpen((o) => !o)}
      onKeyDown={(e) => {
        if (e.target === e.currentTarget && (e.key === "Enter" || e.key === " ")) {
          e.preventDefault();
          setOpen((o) => !o);
        }
      }}
      className="cursor-pointer rounded-xl bg-white px-4 py-3 shadow-[0_4px_20px_rgba(0,0,0,0.06)] hover:bg-[#fcfcfc]"
    >
      {/* The name, and the buttons beside it -- they move under the name
          when there isn't room. */}
      <div className="flex flex-wrap items-center gap-x-3 gap-y-2">
        <p className="flex min-w-0 max-w-full shrink-0 grow basis-auto items-center gap-2 overflow-hidden whitespace-nowrap text-clip font-semibold text-brand">
          <span aria-hidden="true" className="shrink-0 text-[10px] text-[#999]">
            {open ? "▼" : "▶"}
          </span>
          {servant.full_name}
        </p>
        {!approved && (
          <div className="flex shrink-0 items-center gap-2" onClick={(e) => e.stopPropagation()}>
            <button
              type="button"
              onClick={handleApprove}
              disabled={busy}
              className="rounded-md bg-brand px-3 py-1.5 text-xs font-semibold text-white hover:bg-brand-dark disabled:opacity-60 shadow-[0_2px_4px_rgba(0,0,0,0.15)]"
            >
              <BusyLabel busy={busy && action === "approve"} busyText="Approving…">
                Approve
              </BusyLabel>
            </button>
            <button
              type="button"
              onClick={handleRemove}
              disabled={busy}
              className="rounded-md bg-[#f0f0f0] px-3 py-1.5 text-xs font-semibold text-[#dc3545] hover:bg-[#f8d7da] disabled:opacity-60"
            >
              <BusyLabel busy={busy && action === "remove"} busyText="Removing…">
                Remove
              </BusyLabel>
            </button>
          </div>
        )}
      </div>
      <p className={`mt-1 text-xs ${approved ? "text-[#777]" : "font-semibold text-[#8a6d00]"}`}>{status}</p>
      {error && <p className="mt-1 text-xs text-[#dc3545]">{error}</p>}

      {open && (
        <div className="mt-2 border-t border-[#f0f0f0] pt-2">
          <p className="text-xs text-[#666]">
            {servant.phone ?? "—"} · {servant.email ?? "—"} · {servant.gender ?? "—"}
          </p>
          {servant.father_of_confession && <p className="text-xs text-[#666]">Father of Confession: {servant.father_of_confession}</p>}
          {servant.registration_comments && (
            <p className="text-xs text-[#666] italic">&ldquo;{servant.registration_comments}&rdquo;</p>
          )}
          <p className="mt-1 text-xs text-[#999]">
            First registered {formatDateTimeInZone(servant.submitted_at, timeZone, { year: "numeric", month: "short", day: "numeric" })} ·
            checked in {servant.checkInCount} time{servant.checkInCount === 1 ? "" : "s"}
          </p>
          {approved && (
            <p className="mt-1 text-xs text-[#888]">
              {servant.approved_at
                ? `Approved ${formatDateTimeInZone(servant.approved_at, timeZone, { month: "short", day: "numeric" })}${servant.approved_by_name ? ` by ${servant.approved_by_name}` : ""}. `
                : "Approved. "}
              {stage === "agreement"
                ? "They'll leave this list once they sign the Confidentiality Agreement."
                : "They'll leave this list the first time they open the app."}
            </p>
          )}
        </div>
      )}
    </div>
  );
}
