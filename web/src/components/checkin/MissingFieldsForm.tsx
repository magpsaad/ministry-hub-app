"use client";

import { useRef, useState } from "react";
import type { University } from "@/lib/universities";
import { fillMissingMemberFieldsAction, type MissingFieldsInput, type MissingMemberFields } from "@/app/checkin/actions";
import { todayInZone } from "@/lib/timezone";
import { useTimezone } from "@/components/TimezoneProvider";
import { PARENT_FIELDS } from "@/lib/parent-contacts";
import { BusyLabel } from "@/components/PendingButton";

const inputClass =
  "w-full rounded-md border border-[#ddd] px-3 py-2.5 text-base focus:border-brand focus:outline-none focus:ring-2 focus:ring-brand/10";

const EMPTY: MissingFieldsInput = {
  phone: null,
  email: null,
  university_id: null,
  program_of_study: null,
  date_of_birth: null,
  father_of_confession: null,
};

/** Owner-requested: shown on the check-in success screen (member/youth flow
 * only), right after "Not you? Undo" -- offers to fill in whichever of
 * Phone/Email/University/Program of Study/Date of Birth/Father of
 * Confession are currently blank on this person's own record. Deliberately
 * never shows any of their existing data (privacy) and never Servant
 * Comments (confidential) -- every field here starts blank, and only the
 * fields the server said are actually missing are rendered at all. */
export function MissingFieldsForm({
  token,
  memberId,
  missing,
  universities,
  universityLabel,
  programLabel,
  onDone,
}: {
  token: string;
  memberId: string;
  missing: MissingMemberFields;
  universities: University[];
  universityLabel: string;
  programLabel: string;
  onDone: () => void;
}) {
  const timeZone = useTimezone();
  const [form, setForm] = useState<MissingFieldsInput>(EMPTY);
  const [pending, setPending] = useState(false);
  const saving = useRef(false);
  const [error, setError] = useState<string | null>(null);

  function field<K extends keyof MissingFieldsInput>(key: K, value: MissingFieldsInput[K]) {
    setForm((f) => ({ ...f, [key]: value }));
  }

  const missingParents = PARENT_FIELDS.filter(({ key }) => missing.parents[key]);
  const hasAnyMissing =
    missing.phone || missing.email || missing.university || missing.program || missing.dob || missing.fatherOfConfession || missingParents.length > 0;
  if (!hasAnyMissing) return null;

  const hasAnyInput =
    !!form.phone?.trim() || !!form.email?.trim() || !!form.university_id || !!form.program_of_study?.trim() || !!form.date_of_birth || !!form.father_of_confession?.trim() ||
    missingParents.some(({ key }) => !!form[key]?.trim());

  async function handleSave() {
    if (saving.current) return;
    saving.current = true;
    try {
      await saveOnce();
    } finally {
      saving.current = false;
    }
  }

  async function saveOnce() {
    setPending(true);
    setError(null);
    const result = await fillMissingMemberFieldsAction(token, memberId, form);
    setPending(false);
    if (result.error) {
      setError(result.error);
      return;
    }
    onDone();
  }

  return (
    <div className="mt-5 rounded-lg border border-[#ddd] bg-[#f9f9f9] p-4 text-left">
      <h3 className="text-sm font-bold text-brand">Help us complete your record</h3>
      <p className="mt-1 text-xs text-[#666]">
        A few details are missing. Fill in whatever you&rsquo;d like below — the rest can stay blank.
      </p>
      {error && <p className="mt-2 text-sm text-[#dc3545]">{error}</p>}
      <div className="mt-3 space-y-3">
        {missing.phone && (
          <Field label="Phone Number">
            <input type="tel" value={form.phone ?? ""} onChange={(e) => field("phone", e.target.value || null)} className={inputClass} />
          </Field>
        )}
        {missing.email && (
          <Field label="Email Address">
            <input type="email" value={form.email ?? ""} onChange={(e) => field("email", e.target.value || null)} className={inputClass} />
          </Field>
        )}
        {missing.university && (
          <Field label={universityLabel}>
            <select value={form.university_id ?? ""} onChange={(e) => field("university_id", e.target.value || null)} className={inputClass}>
              <option value="">—</option>
              {universities.map((u) => (
                <option key={u.id} value={u.id}>
                  {u.name}
                </option>
              ))}
            </select>
          </Field>
        )}
        {missing.program && (
          <Field label={programLabel}>
            <input value={form.program_of_study ?? ""} onChange={(e) => field("program_of_study", e.target.value || null)} className={inputClass} />
          </Field>
        )}
        {missing.dob && (
          <Field label="Date of Birth">
            <input
              type="date"
              max={todayInZone(timeZone)}
              value={form.date_of_birth ?? ""}
              onChange={(e) => field("date_of_birth", e.target.value || null)}
              className={inputClass}
            />
          </Field>
        )}
        {missing.fatherOfConfession && (
          <Field label="Father of Confession">
            <input value={form.father_of_confession ?? ""} onChange={(e) => field("father_of_confession", e.target.value || null)} className={inputClass} />
          </Field>
        )}
        {missingParents.map(({ key, label, kind, maxLength }) => (
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
      </div>
      <div className="mt-4 flex gap-2">
        <button
          type="button"
          onClick={handleSave}
          disabled={pending || !hasAnyInput}
          className="flex-1 rounded-md bg-brand px-4 py-2.5 text-sm font-semibold text-white hover:bg-brand-dark disabled:opacity-50 shadow-[0_2px_4px_rgba(0,0,0,0.15)] transition-all hover:-translate-y-0.5 hover:shadow-[0_4px_8px_rgba(0,0,0,0.2)] active:translate-y-0 active:shadow-[0_1px_2px_rgba(0,0,0,0.15)]"
        >
          <BusyLabel busy={pending} busyText="Saving…">
            Save
          </BusyLabel>
        </button>
        <button
          type="button"
          onClick={onDone}
          className="rounded-md bg-[#f0f0f0] px-4 py-2.5 text-sm font-semibold text-[#333] hover:bg-[#e0e0e0]"
        >
          Not now
        </button>
      </div>
    </div>
  );
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div>
      <label className="block text-xs font-semibold text-[#333] mb-1">{label}</label>
      {children}
    </div>
  );
}
