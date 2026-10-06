"use client";

import { checkinPersonProblem, parentsProblem } from "@/lib/checkin-validation";
import { PARENT_FIELDS } from "@/lib/parent-contacts";
import { useRef, useState } from "react";
import type { University } from "@/lib/universities";
import {
  submitNewMemberAction,
  checkPossibleDuplicateMemberAction,
  type NewMemberInput,
  type DuplicateMatch,
} from "@/app/checkin/actions";
import { todayInZone } from "@/lib/timezone";
import { useTimezone } from "@/components/TimezoneProvider";
import { PossibleDuplicateMemberModal } from "./PossibleDuplicateMemberModal";
import { BusyLabel } from "@/components/PendingButton";

const inputClass =
  "w-full rounded-md border border-[#ddd] px-3 py-2.5 text-base focus:border-brand focus:outline-none focus:ring-2 focus:ring-brand/10";


const EMPTY_FORM: NewMemberInput = {
  full_name: "",
  phone: null,
  email: null,
  university_id: null,
  program_of_study: null,
  date_of_birth: null,
  father_of_confession: null,
  home_address: null,
  gender: null,
  comments: null,
};

/** Client-side mirror of the server-side checks in app/checkin/actions.ts --
 * gives instant feedback, but the server never trusts this alone. */
function validate(form: NewMemberInput, showParents: boolean): string | null {
  return checkinPersonProblem(form) ?? (showParents ? parentsProblem(form) : null);
}

/** REQUIREMENTS.md §6.11 -- "Don't see your name?" intake, same fields as
 * the member schema. Creates the roster record AND (service-day permitting)
 * today's attendance in one shot. Name/Phone/Email/Gender are required and
 * listed first; the rest stays free-form. */
export function MemberIntakeForm({
  token,
  universities,
  universityLabel,
  programLabel,
  groupLabel,
  memberLabel,
  currentGroupName,
  showParents,
  onBack,
  onSubmitted,
}: {
  token: string;
  universities: University[];
  universityLabel: string;
  programLabel: string;
  groupLabel: string;
  memberLabel: string;
  currentGroupName: string;
  /** Migration 0087 -- this ministry keeps parents' contact details. */
  showParents: boolean;
  onBack?: () => void;
  onSubmitted: (name: string, attendanceRecorded: boolean, wasResolvedDuplicate?: boolean) => void;
}) {
  const timeZone = useTimezone();
  const [form, setForm] = useState<NewMemberInput>(EMPTY_FORM);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  // Owner-requested: before actually creating a new record, check whether
  // a likely match already exists (possibly in another cohort -- the
  // tap-a-name list only ever searches the one cohort she scanned into,
  // so it can't catch that case). Non-null while that confirmation step
  // is showing instead of the form.
  const [duplicateMatch, setDuplicateMatch] = useState<DuplicateMatch | null>(null);

  function field<K extends keyof NewMemberInput>(key: K, value: NewMemberInput[K]) {
    setForm((f) => ({ ...f, [key]: value }));
  }

  async function createNewRecord() {
    setPending(true);
    setError(null);
    const result = await submitNewMemberAction(token, form);
    setPending(false);
    if (result.error) {
      setError(result.error);
      return;
    }
    onSubmitted(form.full_name, result.attendanceRecorded);
  }

  const submitting = useRef(false);
  // Owner-reported (5 Oct 2026): one submit at a time, even for two taps
  // landing before the button has greyed out.
  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (submitting.current) return;
    submitting.current = true;
    try {
      await submitOnce();
    } finally {
      submitting.current = false;
    }
  }

  async function submitOnce() {
    const validationError = validate(form, showParents);
    if (validationError) {
      setError(validationError);
      return;
    }
    setPending(true);
    setError(null);
    const match = await checkPossibleDuplicateMemberAction(token, form);
    setPending(false);
    if (match) {
      setDuplicateMatch(match);
      return;
    }
    await createNewRecord();
  }

  if (duplicateMatch) {
    return (
      <PossibleDuplicateMemberModal
        token={token}
        match={duplicateMatch}
        groupLabel={groupLabel}
        formInput={form}
        currentGroupName={currentGroupName}
        onNotMe={() => {
          setDuplicateMatch(null);
          void createNewRecord();
        }}
        onResolved={(attendanceRecorded) => onSubmitted(form.full_name, attendanceRecorded, true)}
        onEdit={(message) => {
          setDuplicateMatch(null);
          setError(message);
        }}
      />
    );
  }

  return (
    <form onSubmit={handleSubmit} className="rounded-xl bg-white shadow-[0_4px_20px_rgba(0,0,0,0.06)] p-4 space-y-3">
      <h2 className="text-base font-bold text-brand">New {memberLabel} Registration</h2>
      <Field label="Full Name *">
        <input
          required
          value={form.full_name}
          onChange={(e) => field("full_name", e.target.value)}
          className={inputClass}
        />
      </Field>
      <Field label="Phone *">
        <input
          required
          type="tel"
          value={form.phone ?? ""}
          onChange={(e) => field("phone", e.target.value || null)}
          className={inputClass}
        />
      </Field>
      <Field label="Email *">
        <input
          required
          type="email"
          value={form.email ?? ""}
          onChange={(e) => field("email", e.target.value || null)}
          className={inputClass}
        />
      </Field>
      <Field label="Gender *">
        <select
          required
          value={form.gender ?? ""}
          onChange={(e) => field("gender", e.target.value || null)}
          className={inputClass}
        >
          <option value="">—</option>
          <option value="Male">Male</option>
          <option value="Female">Female</option>
        </select>
      </Field>
      <Field label={universityLabel}>
        <select
          value={form.university_id ?? ""}
          onChange={(e) => field("university_id", e.target.value || null)}
          className={inputClass}
        >
          <option value="">—</option>
          {universities.map((u) => (
            <option key={u.id} value={u.id}>
              {u.name}
            </option>
          ))}
        </select>
      </Field>
      <Field label={programLabel}>
        <input
          value={form.program_of_study ?? ""}
          onChange={(e) => field("program_of_study", e.target.value || null)}
          className={inputClass}
        />
      </Field>
      <Field label="Date of Birth">
        <input
          type="date"
          max={todayInZone(timeZone)}
          value={form.date_of_birth ?? ""}
          onChange={(e) => field("date_of_birth", e.target.value || null)}
          className={inputClass}
        />
      </Field>
      <Field label="Father of Confession">
        <input
          value={form.father_of_confession ?? ""}
          onChange={(e) => field("father_of_confession", e.target.value || null)}
          className={inputClass}
        />
      </Field>
      <Field label="Home Address">
        <input
          value={form.home_address ?? ""}
          onChange={(e) => field("home_address", e.target.value || null)}
          className={inputClass}
        />
      </Field>
      {showParents &&
        PARENT_FIELDS.map(({ key, label, kind, maxLength }) => (
          <Field key={key} label={label}>
            <input
              type={kind === "phone" ? "tel" : kind === "email" ? "email" : "text"}
              value={form[key] ?? ""}
              onChange={(e) => field(key, e.target.value || null)}
              maxLength={maxLength}
              className={inputClass}
            />
          </Field>
        ))}
      <Field label="Comments">
        <textarea
          value={form.comments ?? ""}
          onChange={(e) => field("comments", e.target.value || null)}
          className={inputClass}
          rows={2}
        />
      </Field>
      {/* Next to Submit, where the person is (owner-reported: at the top of
          a long form it went unseen). */}
      {error && (
        <p role="alert" className="rounded-md bg-[#f8d7da] px-3 py-2 text-sm text-[#721c24]">
          {error}
        </p>
      )}
      <div className="flex gap-2 pt-2">
        {onBack && (
          <button
            type="button"
            onClick={onBack}
            className="rounded-md bg-[#f0f0f0] px-4 py-3 text-sm font-semibold text-[#333] hover:bg-[#e0e0e0] shadow-[0_2px_4px_rgba(0,0,0,0.1)] transition-all hover:-translate-y-0.5 hover:shadow-[0_4px_8px_rgba(0,0,0,0.15)] active:translate-y-0 active:shadow-[0_1px_2px_rgba(0,0,0,0.1)]"
          >
            Back
          </button>
        )}
        <button
          type="submit"
          disabled={pending}
          className="flex-1 rounded-md bg-brand px-4 py-3 text-sm font-semibold text-white hover:bg-brand-dark disabled:opacity-60 shadow-[0_2px_4px_rgba(0,0,0,0.15)] transition-all hover:-translate-y-0.5 hover:shadow-[0_4px_8px_rgba(0,0,0,0.2)] active:translate-y-0 active:shadow-[0_1px_2px_rgba(0,0,0,0.15)]"
        >
          <BusyLabel busy={pending} busyText="Submitting…">
            Submit
          </BusyLabel>
        </button>
      </div>
    </form>
  );
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div>
      <label className="block text-sm font-semibold text-[#333] mb-1">{label}</label>
      {children}
    </div>
  );
}
