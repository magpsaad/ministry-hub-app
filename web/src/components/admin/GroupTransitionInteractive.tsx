"use client";

import { useState, useTransition } from "react";
import Link from "next/link";
import type { HandOverMode, TransitionInput, TransitionReport } from "@/lib/group-transition";
import type { AssignmentPerson } from "@/lib/servant-assignments";
import type { GroupSummary } from "@/lib/groups";
import {
  archiveHandOverAction,
  getPostTransitionReviewDataAction,
  previewTransitionAction,
  runGroupTransitionAction,
} from "@/app/admin/group-transition/actions";
import { levelText } from "@/lib/group-names";
import { ServantAssignmentsInteractive } from "@/components/ServantAssignmentsInteractive";

type Stage = "preview" | "confirming" | "done";

const card = "rounded-xl bg-white shadow-[0_4px_20px_rgba(0,0,0,0.06)] p-5";
const input = "rounded-md border border-[#ddd] px-2 py-1.5 text-sm focus:border-brand focus:outline-none";
const lift =
  "shadow-[0_2px_4px_rgba(0,0,0,0.15)] transition-all hover:-translate-y-0.5 hover:shadow-[0_4px_8px_rgba(0,0,0,0.2)] active:translate-y-0 active:shadow-[0_1px_2px_rgba(0,0,0,0.15)]";

const MODE_LABELS: Record<HandOverMode, string> = {
  one: "One hand-over group for all of them",
  by_gender: "One hand-over group per gender",
  separate: "Keep each class separate",
};

const ROLE_LABELS: Record<string, string> = {
  servant: "Servant",
  sub_coordinator: "Coordinator",
  read_only: "Read-Only",
};

/** GROUP_LADDER_PLAN.md §4.5 -- the Group Transition screen. The preview
 * comes from the database (the run itself, undone), so what it shows is
 * exactly what the run will do. Blocked while anyone is still in the
 * hand-over group (D6): the screen lists them, lets you download the list
 * for the next ministry, and offers "Archive them now". When two or more
 * groups graduate it asks how they enter hand-over (D12). Then the
 * two-step confirm, the QR reprint prompt and the optional assignment
 * review, as before. */
export function GroupTransitionInteractive({
  initialPreview,
  initialYear,
  positionLabel,
  levelOffset,
  groupLabel,
  memberLabel,
}: {
  initialPreview: TransitionReport;
  initialYear: number;
  positionLabel: string;
  levelOffset: number;
  groupLabel: string;
  memberLabel: string;
}) {
  const [preview, setPreview] = useState(initialPreview);
  const [year, setYear] = useState(initialYear);
  const [preName, setPreName] = useState("");
  const [mode, setMode] = useState<HandOverMode>("one");
  const [handOverNames, setHandOverNames] = useState<string[]>([]);
  const [stage, setStage] = useState<Stage>("preview");
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<TransitionReport | null>(null);
  const [reviewData, setReviewData] = useState<{ people: AssignmentPerson[]; groups: GroupSummary[] } | null>(null);
  const [showReview, setShowReview] = useState(false);
  const [showOccupants, setShowOccupants] = useState(false);

  const level = (n: number) => levelText(n, positionLabel, levelOffset);
  const groupWord = groupLabel.toLowerCase();

  function currentInput(overrides: Partial<TransitionInput> = {}): TransitionInput {
    return {
      newPreEntryCohortYear: year,
      newPreEntryName: preName,
      handOverNames,
      handOverMode: mode,
      ...overrides,
    };
  }

  // Re-run the preview with the screen's current choices.
  function refresh(overrides: Partial<TransitionInput> = {}) {
    setError(null);
    startTransition(async () => {
      setPreview(await previewTransitionAction(currentInput(overrides)));
    });
  }

  function handleArchive() {
    const n = preview.occupant_count ?? 0;
    if (!confirm(`Archive the ${n} ${memberLabel.toLowerCase()}(s) still in the hand-over group? Their records, attendance and outreach are kept.`)) return;
    setError(null);
    startTransition(async () => {
      const res = await archiveHandOverAction();
      if (res.error) {
        setError(res.error);
        return;
      }
      setPreview(await previewTransitionAction(currentInput()));
    });
  }

  function downloadOccupants() {
    const rows = [["Name", "Group"], ...(preview.occupants ?? []).map((o) => [o.name, o.group])];
    const csv = rows.map((r) => r.map((c) => `"${c.replaceAll('"', '""')}"`).join(",")).join("\r\n");
    const url = URL.createObjectURL(new Blob([csv], { type: "text/csv" }));
    const a = document.createElement("a");
    a.href = url;
    a.download = "hand-over-list.csv";
    a.click();
    URL.revokeObjectURL(url);
  }

  function handleConfirm() {
    setError(null);
    startTransition(async () => {
      const res = await runGroupTransitionAction(currentInput());
      if (res.error) {
        setError(res.error);
        setStage("preview");
        return;
      }
      setResult(res);
      setStage("done");
    });
  }

  function handleShowReview() {
    setShowReview(true);
    startTransition(async () => {
      setReviewData(await getPostTransitionReviewDataAction());
    });
  }

  if (stage === "done" && result) {
    const renamed = [
      ...(result.groups ?? []).filter((g) => !g.archived && g.new_name !== g.old_name).map((g) => g.new_name),
      ...(result.new_groups ?? []).map((g) => g.name),
    ];
    return (
      <div className="space-y-4">
        <div className={card}>
          <h2 className="text-lg font-bold text-[#155724] mb-2">Transition Complete</h2>
          <p className="text-sm text-[#666] mb-3">These {groupWord}s have a new name or are new — reprint their QR codes:</p>
          <ul className="list-disc pl-5 text-sm text-[#333] mb-4 space-y-0.5">
            {renamed.map((name) => (
              <li key={name}>{name}</li>
            ))}
          </ul>
          <Link
            href="/qr-codes"
            target="_blank"
            rel="noopener noreferrer"
            className={`inline-block rounded-md bg-brand px-4 py-2 text-sm font-semibold text-white hover:bg-brand-dark ${lift}`}
          >
            Go to Print QR Codes (opens in a new tab)
          </Link>
        </div>

        <div className={card}>
          <h2 className="text-lg font-bold text-brand mb-2">Review Servant Assignments (optional)</h2>
          <p className="text-sm text-[#666] mb-3">
            The roles of the {groupWord}(s) that graduated have moved to <strong>{result.new_level_one}</strong>
            {(result.grants_dropped?.length ?? 0) > 0 && " (except for people who still serve another group)"}. Fine-tune
            anyone&rsquo;s assignment now, or skip and do it later in Servant Assignments.
          </p>
          {!showReview ? (
            <button
              type="button"
              onClick={handleShowReview}
              className={`rounded-md bg-brand px-4 py-2 text-sm font-semibold text-white hover:bg-brand-dark ${lift}`}
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

  const graduatingCount = preview.graduating?.length ?? 0;
  const changes = (preview.groups ?? []).filter((g) => g.old_name !== g.new_name || g.old_level !== g.new_level || g.archived);

  return (
    <div className="space-y-4">
      <div className={card}>
        <h2 className="text-lg font-bold text-brand mb-1">New pre-entry {groupWord}</h2>
        <p className="text-sm text-[#666] mb-3">
          Every {groupWord} goes up one level, the current pre-entry {groupWord} becomes {level(1)}, and a new hidden
          pre-entry {groupWord} is created for next year&rsquo;s intake.
        </p>
        <div className="flex flex-wrap items-end gap-3">
          <label className="text-xs font-semibold text-[#555]">
            Year
            <input
              type="number"
              value={year}
              onChange={(e) => setYear(Number(e.target.value))}
              onBlur={() => refresh()}
              className={`mt-1 block w-28 ${input}`}
            />
          </label>
          <label className="flex-1 min-w-[12rem] text-xs font-semibold text-[#555]">
            Name (blank = from the default pattern)
            <input
              value={preName}
              onChange={(e) => setPreName(e.target.value)}
              onBlur={() => refresh()}
              placeholder={preview.new_pre_entry?.name}
              className={`mt-1 block w-full ${input}`}
            />
          </label>
        </div>
      </div>

      {preview.blocked ? (
        <div className={`${card} border-2 border-[#dc3545]`}>
          <h2 className="text-lg font-bold text-[#721c24] mb-1">The hand-over group isn&rsquo;t empty yet</h2>
          <p className="text-sm text-[#721c24] mb-3">
            <strong>{preview.hand_over_groups?.join(", ")}</strong> still has {preview.occupant_count}{" "}
            {memberLabel.toLowerCase()}(s). Hand them over to the next ministry (download the list for its Admin), or
            archive them. Archived people keep their records, attendance and outreach.
          </p>
          <div className="flex flex-wrap gap-2 mb-3">
            <button type="button" onClick={downloadOccupants} className="rounded-md bg-[#f0f0f0] px-4 py-2 text-sm font-semibold text-[#333] hover:bg-[#e0e0e0]">
              Download the list (CSV)
            </button>
            <button
              type="button"
              onClick={handleArchive}
              disabled={pending}
              className={`rounded-md bg-[#dc3545] px-4 py-2 text-sm font-semibold text-white hover:bg-[#c82333] disabled:opacity-60 ${lift}`}
            >
              {pending ? "Working…" : "Archive them now"}
            </button>
            <button type="button" onClick={() => setShowOccupants((v) => !v)} className="text-sm text-brand underline">
              {showOccupants ? "Hide names" : "Show names"}
            </button>
          </div>
          {showOccupants && (
            <ul className="max-h-64 overflow-y-auto columns-1 sm:columns-2 text-sm text-[#333]">
              {(preview.occupants ?? []).map((o) => (
                <li key={o.id}>{o.name}</li>
              ))}
            </ul>
          )}
        </div>
      ) : preview.error ? (
        <div className={`${card} border-2 border-[#dc3545]`}>
          <p className="text-sm text-[#721c24]">{preview.error}</p>
        </div>
      ) : (
        <>
          <div className={card}>
            <h2 className="text-lg font-bold text-brand mb-1">What Will Happen</h2>
            <p className="text-sm text-[#666] mb-3">
              It all runs at once — if anything fails, nothing changes.
            </p>

            {graduatingCount >= 2 && (
              <div className="mb-4 rounded-md border border-[#eee] bg-[#fafafa] p-3">
                <p className="text-sm font-semibold text-[#333] mb-1">
                  {graduatingCount} {groupWord}s graduate together: {preview.graduating?.join(", ")}
                </p>
                {(Object.keys(MODE_LABELS) as HandOverMode[]).map((m) => (
                  <label key={m} className="flex items-center gap-2 text-sm text-[#333]">
                    <input
                      type="radio"
                      checked={mode === m}
                      onChange={() => {
                        setMode(m);
                        setHandOverNames([]);
                        refresh({ handOverMode: m, handOverNames: [] });
                      }}
                    />
                    {MODE_LABELS[m]}
                  </label>
                ))}
              </div>
            )}

            <div className="mb-4 rounded-md bg-[#fff3cd] text-[#856404] text-sm px-3 py-2">
              <p className="mb-2">
                <strong>{preview.graduating?.join(", ")}</strong> {graduatingCount === 1 ? "graduates" : "graduate"}:{" "}
                {preview.hand_over_youths} {memberLabel.toLowerCase()}(s) move to the hidden hand-over group
                {(preview.hand_over_names?.length ?? 0) > 1 ? "s" : ""} (only Admins see them), and their servant
                assignments are cleared.
              </p>
              {(preview.hand_over_names ?? []).map((name, i) => (
                <label key={i} className="block text-xs font-semibold">
                  Hand-over group{(preview.hand_over_names?.length ?? 0) > 1 ? ` ${i + 1}` : ""} name
                  <input
                    value={handOverNames[i] ?? ""}
                    placeholder={name}
                    onChange={(e) =>
                      setHandOverNames((prev) => {
                        const next = [...prev];
                        next[i] = e.target.value;
                        return next;
                      })
                    }
                    onBlur={() => refresh()}
                    className={`mt-1 block w-full ${input} text-[#333]`}
                  />
                </label>
              ))}
              {(preview.unknown_gender?.length ?? 0) > 0 && (
                <p className="mt-2">
                  No gender on file (they go to the first hand-over group): {preview.unknown_gender?.join(", ")}
                </p>
              )}
            </div>

            <div className="divide-y divide-[#f0f0f0] mb-4">
              {changes.map((g) => (
                <div key={g.id} className="py-2 flex flex-wrap items-center justify-between gap-2 text-sm">
                  <span className="text-[#333]">
                    {g.old_name} <span className="text-xs text-[#999]">({g.old_kind === "pre_entry" ? "pre-entry" : g.old_kind === "terminal" ? "hand-over" : level(g.old_level)})</span>
                  </span>
                  <span className="text-[#666]">
                    {g.archived ? (
                      "→ graduates (archived)"
                    ) : (
                      <>
                        → {g.new_name}{" "}
                        <span className="text-xs text-[#999]">({g.new_kind === "terminal" ? "hand-over" : level(g.new_level)})</span>
                      </>
                    )}
                  </span>
                </div>
              ))}
              {(preview.new_groups ?? []).map((g) => (
                <div key={g.name} className="py-2 flex items-center justify-between text-sm">
                  <span className="text-[#999]">(new)</span>
                  <span className="text-[#666]">
                    → {g.name} <span className="text-xs text-[#999]">({g.kind === "pre_entry" ? "pre-entry, QR off" : "hand-over"})</span>
                  </span>
                </div>
              ))}
            </div>

            {((preview.grants_moved?.length ?? 0) > 0 || (preview.grants_dropped?.length ?? 0) > 0) && (
              <div className="mb-3 text-sm text-[#333]">
                {(preview.grants_moved?.length ?? 0) > 0 && (
                  <p className="mb-1">
                    <strong>Roles that move to {preview.new_level_one}:</strong>{" "}
                    {preview.grants_moved?.map((p) => `${p.person} (${ROLE_LABELS[p.role] ?? p.role})`).join(", ")}
                  </p>
                )}
                {(preview.grants_dropped?.length ?? 0) > 0 && (
                  <p>
                    <strong>Roles that end (they still serve another {groupWord}):</strong>{" "}
                    {preview.grants_dropped?.map((p) => `${p.person} (${ROLE_LABELS[p.role] ?? p.role}, ${p.from})`).join(", ")}
                  </p>
                )}
              </div>
            )}
            {(preview.assignments_cleared_total ?? 0) > 0 && (
              <p className="mb-3 text-sm text-[#333]">
                <strong>{preview.assignments_cleared_total} youth assignment(s) will be cleared:</strong>{" "}
                {preview.assignments_cleared?.map((a) => `${a.servant} ${a.count}`).join(", ")}
              </p>
            )}
            {(preview.extra_hand_over_archived?.length ?? 0) > 0 && (
              <p className="mb-3 text-sm text-[#666]">
                Last year&rsquo;s extra hand-over group(s), now empty, are archived:{" "}
                {preview.extra_hand_over_archived?.join(", ")}
              </p>
            )}
          </div>
        </>
      )}

      {error && <p className="text-sm text-[#dc3545]">{error}</p>}

      <div className={card}>
        {stage === "preview" ? (
          <div className="flex flex-wrap items-center gap-3">
            <button
              type="button"
              onClick={() => setStage("confirming")}
              disabled={pending || preview.blocked || !!preview.error}
              className={`rounded-md bg-[#dc3545] px-4 py-2 text-sm font-semibold text-white hover:bg-[#c82333] disabled:opacity-50 disabled:cursor-not-allowed ${lift}`}
            >
              Transition Groups…
            </button>
            {pending && <span className="text-xs text-[#999]">Updating the preview…</span>}
          </div>
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
                className={`rounded-md bg-[#dc3545] px-4 py-2 text-sm font-semibold text-white hover:bg-[#c82333] disabled:opacity-60 ${lift}`}
              >
                {pending ? "Running…" : "Yes, Transition Groups"}
              </button>
              <button
                type="button"
                onClick={() => setStage("preview")}
                className="rounded-md bg-[#f0f0f0] px-4 py-2 text-sm font-semibold text-[#333] hover:bg-[#e0e0e0]"
              >
                Cancel
              </button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
