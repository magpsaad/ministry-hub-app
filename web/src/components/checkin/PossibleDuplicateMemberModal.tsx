"use client";

import { useState } from "react";
import type { University } from "@/lib/universities";
import {
  resolveDuplicateMemberAction,
  type DuplicateMatch,
  type DuplicateResolution,
  type NewMemberInput,
} from "@/app/checkin/actions";

type FieldKey = "name" | "phone" | "email" | "university" | "program" | "dob" | "gender";

// Used mid-sentence ("same X, but a different Y"), hence lowercase; the
// school/program wording is an admin-editable App Setting.
function fieldLabels(universityLabel: string, programLabel: string): Record<FieldKey, string> {
  return {
    name: "name",
    phone: "phone number",
    email: "email address",
    university: universityLabel.toLowerCase(),
    program: programLabel.toLowerCase(),
    dob: "date of birth",
    gender: "gender",
  };
}

function joinWithAnd(items: string[]): string {
  if (items.length === 0) return "";
  if (items.length === 1) return items[0];
  if (items.length === 2) return `${items[0]} and ${items[1]}`;
  return `${items.slice(0, -1).join(", ")}, and ${items[items.length - 1]}`;
}

/** Owner-requested: builds the confirmation message from same/different
 * booleans only -- never the matched record's actual values. A "same"
 * field is safe to name because it's just an echo of what she typed
 * herself; a "different" field is named but its real stored value is
 * never disclosed. */
function buildMessage(match: DuplicateMatch, labels: Record<FieldKey, string>, groupLabel: string): string {
  const checks: { key: FieldKey; matched: boolean | null }[] = [
    { key: "name", matched: match.nameMatches },
    { key: "phone", matched: match.phoneMatches },
    { key: "email", matched: match.emailMatches },
    { key: "university", matched: match.universityMatches },
    { key: "program", matched: match.programMatches },
    { key: "dob", matched: match.dobMatches },
    { key: "gender", matched: match.genderMatches },
  ];
  const same = checks.filter((c) => c.matched === true).map((c) => labels[c.key]);
  const different = checks.filter((c) => c.matched === false).map((c) => labels[c.key]);

  let message = "We found a record that might already be you";
  const parts: string[] = [];
  if (same.length > 0) parts.push(`same ${joinWithAnd(same)}`);
  if (different.length > 0) parts.push(`a different ${joinWithAnd(different)}`);
  if (parts.length > 0) message += `: ${parts.join(", but ")}`;
  if (!match.sameGroup) message += `, registered under ${groupLabel} "${match.groupName}"`;
  message += ". Is that you?";
  return message;
}

const EMPTY_RESOLUTION: DuplicateResolution = {
  updatePhone: false,
  updateDob: false,
  updateGender: false,
  updateUniversity: false,
  updateProgram: false,
  updateHomeAddress: false,
  updateFatherOfConfession: false,
  moveToScannedGroup: false,
};

/** Owner-requested: shown instead of silently creating a duplicate member
 * record when checkPossibleDuplicateMemberAction finds a likely existing
 * match (possibly in a different cohort -- the tap-a-name list only ever
 * searches the one cohort's own roster, so it never would have caught
 * this). "Not me" proceeds with the normal new-registration flow; "Yes,
 * it's me" moves to a second step offering only the specific field
 * updates that actually differ (plus address/Father of Confession
 * unconditionally, and a cohort move if she's in a different one), then
 * marks today's attendance against her real, existing record instead of
 * creating a new one. */
export function PossibleDuplicateMemberModal({
  token,
  match,
  universities,
  universityLabel,
  programLabel,
  groupLabel,
  formInput,
  currentGroupName,
  onNotMe,
  onResolved,
}: {
  token: string;
  match: DuplicateMatch;
  universities: University[];
  universityLabel: string;
  programLabel: string;
  groupLabel: string;
  formInput: NewMemberInput;
  currentGroupName: string;
  onNotMe: () => void;
  onResolved: (attendanceRecorded: boolean) => void;
}) {
  const [step, setStep] = useState<"confirm" | "resolve">("confirm");
  const [resolution, setResolution] = useState<DuplicateResolution>(EMPTY_RESOLUTION);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);

  function toggle<K extends keyof DuplicateResolution>(key: K) {
    setResolution((r) => ({ ...r, [key]: !r[key] }));
  }

  async function handleConfirmResolve() {
    setPending(true);
    setError(null);
    const result = await resolveDuplicateMemberAction(token, match.memberId, formInput, resolution);
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
          {buildMessage(match, fieldLabels(universityLabel, programLabel), groupLabel)}
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

  const university = universities.find((u) => u.id === formInput.university_id);

  return (
    <div className="rounded-xl bg-white shadow-[0_4px_20px_rgba(0,0,0,0.06)] p-4 space-y-3">
      <h2 className="text-base font-bold text-brand">Update your record?</h2>
      <p className="text-xs text-[#666]">Check anything you&rsquo;d like to update -- leave the rest as it is.</p>
      {error && <p className="text-sm text-[#dc3545]">{error}</p>}

      <div className="space-y-2">
        {match.phoneMatches === false && formInput.phone && (
          <Checkbox checked={resolution.updatePhone} onChange={() => toggle("updatePhone")}>
            Change my phone number to the one I just entered
          </Checkbox>
        )}
        {match.dobMatches === false && formInput.date_of_birth && (
          <Checkbox checked={resolution.updateDob} onChange={() => toggle("updateDob")}>
            Change my date of birth to the one I just entered
          </Checkbox>
        )}
        {match.genderMatches === false && formInput.gender && (
          <Checkbox checked={resolution.updateGender} onChange={() => toggle("updateGender")}>
            Change my gender to the one I just entered
          </Checkbox>
        )}
        {match.universityMatches === false && university && (
          <Checkbox checked={resolution.updateUniversity} onChange={() => toggle("updateUniversity")}>
            Change my {universityLabel.toLowerCase()} to {university.name}
          </Checkbox>
        )}
        {match.programMatches === false && formInput.program_of_study && (
          <Checkbox checked={resolution.updateProgram} onChange={() => toggle("updateProgram")}>
            Change my {programLabel.toLowerCase()} to the one I just entered
          </Checkbox>
        )}
        {formInput.home_address && (
          <Checkbox checked={resolution.updateHomeAddress} onChange={() => toggle("updateHomeAddress")}>
            Update my home address to the one I just entered
          </Checkbox>
        )}
        {formInput.father_of_confession && (
          <Checkbox checked={resolution.updateFatherOfConfession} onChange={() => toggle("updateFatherOfConfession")}>
            Update my Father of Confession to the one I just entered
          </Checkbox>
        )}
        {!match.sameGroup && (
          <Checkbox checked={resolution.moveToScannedGroup} onChange={() => toggle("moveToScannedGroup")}>
            Move my record to {currentGroupName}
          </Checkbox>
        )}
      </div>

      <button
        type="button"
        onClick={handleConfirmResolve}
        disabled={pending}
        className="w-full rounded-md bg-brand px-4 py-3 text-sm font-semibold text-white hover:bg-brand-dark disabled:opacity-60 shadow-[0_2px_4px_rgba(0,0,0,0.15)] transition-all hover:-translate-y-0.5 hover:shadow-[0_4px_8px_rgba(0,0,0,0.2)] active:translate-y-0 active:shadow-[0_1px_2px_rgba(0,0,0,0.15)]"
      >
        {pending ? "Saving…" : "Confirm"}
      </button>
    </div>
  );
}

function Checkbox({ checked, onChange, children }: { checked: boolean; onChange: () => void; children: React.ReactNode }) {
  return (
    <label className="flex items-start gap-2 text-sm text-[#333]">
      <input type="checkbox" checked={checked} onChange={onChange} className="mt-0.5 h-4 w-4 accent-brand" />
      <span>{children}</span>
    </label>
  );
}
