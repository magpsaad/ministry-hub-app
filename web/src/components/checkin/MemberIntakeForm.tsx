"use client";

import { useState } from "react";
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

const inputClass =
  "w-full rounded-md border border-[#ddd] px-3 py-2.5 text-base focus:border-brand focus:outline-none focus:ring-2 focus:ring-brand/10";

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

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
function validate(form: NewMemberInput): string | null {
  if (!form.full_name.trim() || form.full_name.trim().split(/\s+/).length < 2) {
    return "Please enter your first and last name.";
  }
  const digits = (form.phone ?? "").replace(/\D/g, "");
  if (digits.length < 10 || digits.length > 11) {
    return "Please enter a valid phone number.";
  }
  if (!form.email || !EMAIL_RE.test(form.email.trim())) {
    return "Please enter a valid email address.";
  }
  if (!form.gender) {
    return "Please select a gender.";
  }
  return null;
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

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    const validationError = validate(form);
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
        universities={universities}
        universityLabel={universityLabel}
        programLabel={programLabel}
        groupLabel={groupLabel}
        formInput={form}
        currentGroupName={currentGroupName}
        onNotMe={() => {
          setDuplicateMatch(null);
          void createNewRecord();
        }}
        onResolved={(attendanceRecorded) => onSubmitted(form.full_name, attendanceRecorded, true)}
      />
    );
  }

  return (
    <form onSubmit={handleSubmit} className="rounded-xl bg-white shadow-[0_4px_20px_rgba(0,0,0,0.06)] p-4 space-y-3">
      <h2 className="text-base font-bold text-brand">New {memberLabel} Registration</h2>
      {error && <p className="text-sm text-[#dc3545]">{error}</p>}
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
      <Field label="Comments">
        <textarea
          value={form.comments ?? ""}
          onChange={(e) => field("comments", e.target.value || null)}
          className={inputClass}
          rows={2}
        />
      </Field>
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
          {pending ? "Submitting…" : "Submit"}
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
