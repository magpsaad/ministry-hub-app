"use client";

import { checkinPersonProblem } from "@/lib/checkin-validation";
import { useState } from "react";
import { submitNewServantAction, type NewServantInput } from "@/app/checkin/actions";

const inputClass =
  "w-full rounded-md border border-[#ddd] px-3 py-2.5 text-base focus:border-brand focus:outline-none focus:ring-2 focus:ring-brand/10";


const EMPTY_FORM: NewServantInput = {
  full_name: "",
  phone: null,
  email: null,
  father_of_confession: null,
  gender: null,
  comments: null,
};

function validate(form: NewServantInput): string | null {
  return checkinPersonProblem(form);
}

/** New servant self-registration (0014_servant_self_registration.sql) --
 * deliberately captures info + (service-day permitting) attendance only,
 * no app account. An Admin/General Coordinator reviews and approves it
 * later; the account is created automatically the first time this person
 * actually signs into the app themselves. */
export function ServantIntakeForm({
  token,
  onBack,
  onSubmitted,
}: {
  token: string;
  onBack?: () => void;
  onSubmitted: (name: string, attendanceRecorded: boolean) => void;
}) {
  const [form, setForm] = useState<NewServantInput>(EMPTY_FORM);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);

  function field<K extends keyof NewServantInput>(key: K, value: NewServantInput[K]) {
    setForm((f) => ({ ...f, [key]: value }));
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
    const result = await submitNewServantAction(token, form);
    setPending(false);
    if (result.error) {
      setError(result.error);
      return;
    }
    onSubmitted(form.full_name, result.attendanceRecorded);
  }

  return (
    <form onSubmit={handleSubmit} className="rounded-xl bg-white shadow-[0_4px_20px_rgba(0,0,0,0.06)] p-4 space-y-3">
      <h2 className="text-base font-bold text-brand">New Servant Registration</h2>
      <p className="text-xs text-[#666]">
        Your info will be recorded. A coordinator will follow up to give you app access.
      </p>
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
      <Field label="Father of Confession">
        <input
          value={form.father_of_confession ?? ""}
          onChange={(e) => field("father_of_confession", e.target.value || null)}
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
