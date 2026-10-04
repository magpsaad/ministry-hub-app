"use client";

import { useState } from "react";
import { resolveDuplicateMemberAction, type DuplicateMatch, type NewMemberInput } from "@/app/checkin/actions";

/** Owner-requested: shown instead of silently creating a duplicate record
 * when checkPossibleDuplicateMemberAction finds a likely existing match
 * (possibly in another class). "Not me" carries on with the new
 * registration; "Yes, that's me" checks her in against her existing record.
 *
 * Migration 0074 (owner-requested hardening): the public page can no longer
 * change or move an existing record. What she typed only fills its blank
 * fields; anything that differs, and an optional request to move to the
 * class she scanned, goes to the servants as a note to review. The page is
 * never told which details matched or which class the record is in. */
export function PossibleDuplicateMemberModal({
  token,
  match,
  groupLabel,
  formInput,
  currentGroupName,
  onNotMe,
  onResolved,
  onEdit,
}: {
  token: string;
  match: DuplicateMatch;
  groupLabel: string;
  formInput: NewMemberInput;
  currentGroupName: string;
  onNotMe: () => void;
  onResolved: (attendanceRecorded: boolean) => void;
  /** Back to the form with the details as typed (owner-reported: an error
   * here used to leave no way to fix them). */
  onEdit: (message: string | null) => void;
}) {
  const [step, setStep] = useState<"confirm" | "resolve">("confirm");
  const [moveRequested, setMoveRequested] = useState(false);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function handleConfirm() {
    setPending(true);
    setError(null);
    const result = await resolveDuplicateMemberAction(token, formInput, moveRequested);
    setPending(false);
    if (result.error) {
      setError(result.error);
      return;
    }
    onResolved(result.attendanceRecorded);
  }

  if (step === "confirm") {
    return (
      <div className="rounded-xl bg-white shadow-[0_4px_20px_rgba(0,0,0,0.06)] p-4 space-y-4">
        <p className="text-sm text-[#333]">
          We found a record that looks like yours
          {match.sameGroup ? "" : `, registered in another ${groupLabel.toLowerCase()}`}. Is that you?
        </p>
        <div className="flex gap-2">
          <button
            type="button"
            onClick={() => setStep("resolve")}
            className="flex-1 rounded-md bg-brand px-4 py-3 text-sm font-semibold text-white hover:bg-brand-dark shadow-[0_2px_4px_rgba(0,0,0,0.15)] transition-all hover:-translate-y-0.5 hover:shadow-[0_4px_8px_rgba(0,0,0,0.2)] active:translate-y-0 active:shadow-[0_1px_2px_rgba(0,0,0,0.15)]"
          >
            Yes, that&rsquo;s me
          </button>
          <button
            type="button"
            onClick={onNotMe}
            className="flex-1 rounded-md bg-[#f0f0f0] px-4 py-3 text-sm font-semibold text-[#333] hover:bg-[#e0e0e0] shadow-[0_2px_4px_rgba(0,0,0,0.1)] transition-all hover:-translate-y-0.5 hover:shadow-[0_4px_8px_rgba(0,0,0,0.15)] active:translate-y-0 active:shadow-[0_1px_2px_rgba(0,0,0,0.1)]"
          >
            No, that&rsquo;s not me
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className="rounded-xl bg-white shadow-[0_4px_20px_rgba(0,0,0,0.06)] p-4 space-y-3">
      <h2 className="text-base font-bold text-brand">We&rsquo;ll check you in on your record</h2>
      <p className="text-sm text-[#666]">
        Anything you entered that&rsquo;s missing from your record will be added. If anything you entered is different
        from what we have, your servants will review it and update your record.
      </p>
      {error && (
        <div className="space-y-2">
          <p className="text-sm text-[#dc3545]">{error}</p>
          <button
            type="button"
            onClick={() => onEdit(error)}
            className="w-full rounded-md border border-brand bg-white px-4 py-2.5 text-sm font-semibold text-brand hover:bg-[#f0f4f8]"
          >
            Edit my details
          </button>
        </div>
      )}
      {!match.sameGroup && (
        <label className="flex items-start gap-2 text-sm text-[#333]">
          <input
            type="checkbox"
            checked={moveRequested}
            onChange={() => setMoveRequested((v) => !v)}
            className="mt-0.5 h-4 w-4 accent-brand"
          />
          <span>Ask my servants to move me to {currentGroupName}</span>
        </label>
      )}
      <button
        type="button"
        onClick={handleConfirm}
        disabled={pending}
        className="w-full rounded-md bg-brand px-4 py-3 text-sm font-semibold text-white hover:bg-brand-dark disabled:opacity-60 shadow-[0_2px_4px_rgba(0,0,0,0.15)] transition-all hover:-translate-y-0.5 hover:shadow-[0_4px_8px_rgba(0,0,0,0.2)] active:translate-y-0 active:shadow-[0_1px_2px_rgba(0,0,0,0.15)]"
      >
        {pending ? "Saving…" : "Confirm"}
      </button>
    </div>
  );
}
