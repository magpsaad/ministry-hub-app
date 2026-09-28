"use client";

import { useState, useTransition } from "react";
import Link from "next/link";
import type { TransitionPreview } from "@/lib/group-transition";
import type { AssignmentPerson } from "@/lib/servant-assignments";
import type { GroupSummary } from "@/lib/groups";
import {
  runGroupTransitionAction,
  getPostTransitionReviewDataAction,
} from "@/app/admin/group-transition/actions";
import { ServantAssignmentsInteractive } from "@/components/ServantAssignmentsInteractive";

type Stage = "preview" | "confirming" | "done";

/** REQUIREMENTS.md §5 -- confirmation-gated preview, then (on success) the
 * optional/skippable servant-assignment review and the QR reprint prompt.
 * The transition itself runs atomically inside run_group_transition()
 * (migration 0028) -- this component just drives the surrounding flow. */
export function GroupTransitionInteractive({
  initialPreview,
  positionLabel,
  groupLabel,
}: {
  initialPreview: TransitionPreview;
  positionLabel: string;
  groupLabel: string;
}) {
  const pos = positionLabel;
  const [preview] = useState(initialPreview);
  const [newCohortYear, setNewCohortYear] = useState(initialPreview.suggestedNewCohortYear);
  const [stage, setStage] = useState<Stage>("preview");
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const [affectedGroupNames, setAffectedGroupNames] = useState<string[]>([]);
  const [reviewData, setReviewData] = useState<{ people: AssignmentPerson[]; groups: GroupSummary[] } | null>(null);
  const [showReview, setShowReview] = useState(false);

  const advancing = preview.groups.filter((g) => g.nextName && g.nextName !== g.name);

  function handleConfirm() {
    setError(null);
    startTransition(async () => {
      const res = await runGroupTransitionAction(newCohortYear);
      if (res.error) {
        setError(res.error);
        setStage("preview");
        return;
      }
      setAffectedGroupNames(res.affectedGroupNames ?? []);
      setStage("done");
    });
  }

  function handleShowReview() {
    setShowReview(true);
    startTransition(async () => {
      const data = await getPostTransitionReviewDataAction();
      setReviewData(data);
    });
  }

  if (stage === "done") {
    return (
      <div className="space-y-4">
        <div className="rounded-xl bg-white shadow-[0_4px_20px_rgba(0,0,0,0.06)] p-5">
          <h2 className="text-lg font-bold text-[#155724] mb-2">Transition Complete</h2>
          <p className="text-sm text-[#666] mb-3">
            Group labels have changed — reprint QR codes for:
          </p>
          <ul className="list-disc pl-5 text-sm text-[#333] mb-4 space-y-0.5">
            {affectedGroupNames.map((name) => (
              <li key={name}>{name}</li>
            ))}
          </ul>
          <Link
            href="/qr-codes"
            target="_blank"
            rel="noopener noreferrer"
            className="inline-block rounded-md bg-brand px-4 py-2 text-sm font-semibold text-white hover:bg-brand-dark shadow-[0_2px_4px_rgba(0,0,0,0.15)] transition-all hover:-translate-y-0.5 hover:shadow-[0_4px_8px_rgba(0,0,0,0.2)] active:translate-y-0 active:shadow-[0_1px_2px_rgba(0,0,0,0.15)]"
          >
            Go to Print QR Codes (opens in a new tab)
          </Link>
        </div>

        <div className="rounded-xl bg-white shadow-[0_4px_20px_rgba(0,0,0,0.06)] p-5">
          <h2 className="text-lg font-bold text-brand mb-2">Review Servant Assignments (optional)</h2>
          <p className="text-sm text-[#666] mb-3">
            Servants and Coordinators who were scoped to the <em>old</em> terminal group have already been
            reassigned to the new {pos} 1 {groupLabel.toLowerCase()} automatically — the group that just became the new
            terminal group keeps its own servants,
            unaffected. Use this to fine-tune anyone&rsquo;s assignment now, or skip and handle it later via Servant
            Assignments.
          </p>
          {!showReview ? (
            <button
              type="button"
              onClick={handleShowReview}
              className="rounded-md bg-brand px-4 py-2 text-sm font-semibold text-white hover:bg-brand-dark shadow-[0_2px_4px_rgba(0,0,0,0.15)] transition-all hover:-translate-y-0.5 hover:shadow-[0_4px_8px_rgba(0,0,0,0.2)] active:translate-y-0 active:shadow-[0_1px_2px_rgba(0,0,0,0.15)]"
            >
              Review Now
            </button>
          ) : !reviewData ? (
            <p className="text-sm text-[#666]">Loading…</p>
          ) : (
            <ServantAssignmentsInteractive people={reviewData.people} groups={reviewData.groups} canManageServants />
          )}
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-4">
      <div className="rounded-xl bg-white shadow-[0_4px_20px_rgba(0,0,0,0.06)] p-5">
        <h2 className="text-lg font-bold text-brand mb-1">What Will Happen</h2>
        <p className="text-sm text-[#666] mb-4">
          This runs atomically — if anything fails partway through, nothing is changed.
        </p>

        <div className="divide-y divide-[#f0f0f0] mb-4">
          {advancing.map((g) => (
            <div key={g.id} className="py-2 flex items-center justify-between text-sm">
              <span className="text-[#333]">{g.name}</span>
              <span className="text-[#666]">→ {g.nextName}</span>
            </div>
          ))}
        </div>

        {!preview.canTransition && (
          <div className="rounded-md bg-[#f8d7da] text-[#721c24] text-sm px-3 py-2 mb-4">
            <p>{preview.blockedReason}</p>
          </div>
        )}

        {preview.newTerminalGroupName && (
          <div className="rounded-md bg-[#fff3cd] text-[#856404] text-sm px-3 py-2 mb-4">
            <p>
              {pos} {preview.currentNewTerminalPosition} becomes the new {pos} {preview.currentTerminalPosition}+, keeping
              its own name, color, and its own servants unchanged — just like every other year advancing.
              {preview.oldTerminalGroupName && (
                <>
                  {" "}
                  <strong>{preview.oldTerminalGroupName}</strong> (the current {pos} {preview.currentTerminalPosition}+)
                  is absorbed into it and archived: its members join the new terminal roster, and its
                  Servants/Coordinators/Read-Only roll back to serve the new {pos} 1 instead.
                </>
              )}
            </p>
          </div>
        )}

        <div className="flex items-center gap-2">
          <label className="text-sm font-semibold text-[#333]">
            New {pos} 0 {groupLabel.toLowerCase()} year
          </label>
          <input
            type="number"
            value={newCohortYear}
            onChange={(e) => setNewCohortYear(Number(e.target.value))}
            className="w-28 rounded-md border border-[#ddd] px-3 py-2 text-sm focus:border-brand focus:outline-none"
          />
        </div>

        {error && <p className="mt-3 text-sm text-[#dc3545]">{error}</p>}

        <div className="mt-4">
          {stage === "preview" ? (
            <button
              type="button"
              onClick={() => setStage("confirming")}
              disabled={!preview.canTransition}
              className="rounded-md bg-[#dc3545] px-4 py-2 text-sm font-semibold text-white hover:bg-[#c82333] disabled:opacity-50 disabled:cursor-not-allowed shadow-[0_2px_4px_rgba(0,0,0,0.15)] transition-all hover:-translate-y-0.5 hover:shadow-[0_4px_8px_rgba(0,0,0,0.2)] active:translate-y-0 active:shadow-[0_1px_2px_rgba(0,0,0,0.15)]"
            >
              Transition Groups…
            </button>
          ) : (
            <div className="rounded-md border-2 border-[#dc3545] p-4">
              <p className="text-sm font-semibold text-[#721c24] mb-3">
                This cannot be undone from the app. Confirm you want to run this transition now?
              </p>
              <div className="flex gap-2">
                <button
                  type="button"
                  onClick={handleConfirm}
                  disabled={pending}
                  className="rounded-md bg-[#dc3545] px-4 py-2 text-sm font-semibold text-white hover:bg-[#c82333] disabled:opacity-60 shadow-[0_2px_4px_rgba(0,0,0,0.15)] transition-all hover:-translate-y-0.5 hover:shadow-[0_4px_8px_rgba(0,0,0,0.2)] active:translate-y-0 active:shadow-[0_1px_2px_rgba(0,0,0,0.15)]"
                >
                  {pending ? "Running…" : "Yes, Transition Groups"}
                </button>
                <button
                  type="button"
                  onClick={() => setStage("preview")}
                  className="rounded-md bg-[#f0f0f0] px-4 py-2 text-sm font-semibold text-[#333] hover:bg-[#e0e0e0] shadow-[0_2px_4px_rgba(0,0,0,0.1)] transition-all hover:-translate-y-0.5 hover:shadow-[0_4px_8px_rgba(0,0,0,0.15)] active:translate-y-0 active:shadow-[0_1px_2px_rgba(0,0,0,0.1)]"
                >
                  Cancel
                </button>
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
