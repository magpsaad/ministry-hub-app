"use client";

import { useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { submitOwnRegistrationAction, completeOwnProfileAction, type RegistrationInput } from "@/app/register/actions";
import { BusyLabel } from "@/components/PendingButton";
import { NotificationsSetupPanel } from "@/components/notifications/NotificationsSetupPanel";
import { useRoleLabels } from "@/components/RoleLabelsProvider";
import { startNavigationSpinner } from "@/components/NavigationSpinner";

const inputClass =
  "w-full rounded-md border border-[#ddd] px-3 py-2.5 text-base focus:border-brand focus:outline-none focus:ring-2 focus:ring-brand/10";

const EMPTY_FORM: RegistrationInput = { phone: "", gender: "Male", father_of_confession: null, comments: null };

function validate(form: RegistrationInput): string | null {
  const digits = form.phone.replace(/\D/g, "");
  if (digits.length < 10 || digits.length > 11) return "Please enter a valid phone number.";
  if (!form.gender) return "Please select a gender.";
  return null;
}

/**
 * REQUIREMENTS.md §6.1 addendum -- the "exceptional workflow" registration
 * screen. Two modes, same fields, different submit action and copy:
 *   - `hasRole: false` -- this person has no role yet; submitting queues a
 *     pending_servants row for Admin/GC review (still needs approval).
 *   - `hasRole: true` -- a human already granted them a role directly;
 *     submitting updates their own profile immediately, no approval needed.
 */
export function RegisterInteractive({
  hasRole,
  fullName,
  publicKey,
}: {
  hasRole: boolean;
  fullName: string;
  /** Phone notifications (0092): offered once the registration is in. */
  publicKey: string | null;
}) {
  const L = useRoleLabels();
  const router = useRouter();
  const [form, setForm] = useState<RegistrationInput>(EMPTY_FORM);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [submitted, setSubmitted] = useState(false);

  function field<K extends keyof RegistrationInput>(key: K, value: RegistrationInput[K]) {
    setForm((f) => ({ ...f, [key]: value }));
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
    const validationError = validate(form);
    if (validationError) {
      setError(validationError);
      return;
    }
    setPending(true);
    setError(null);
    const action = hasRole ? completeOwnProfileAction : submitOwnRegistrationAction;
    const result = await action(form);
    if (result.error) {
      setPending(false);
      setError(result.error);
      return;
    }
    if (hasRole) {
      // Stays locked (spinner on) until the next page is up.
      startNavigationSpinner();
      router.push("/");
      router.refresh();
    } else {
      setPending(false);
      setSubmitted(true);
    }
  }

  if (submitted) {
    return (
      <div className="rounded-xl bg-white shadow-[0_4px_20px_rgba(0,0,0,0.06)] p-5 text-center space-y-2">
        <h2 className="text-base font-bold text-brand">Thanks, {fullName}!</h2>
        <p className="text-sm text-[#666]">
          Your registration has been submitted. The {L.generalCoordinator} or System Admin will review it and give you access soon.
        </p>
        <div className="border-t border-[#eee] pt-4 mt-3">
          <NotificationsSetupPanel publicKey={publicKey} waitingForApproval />
        </div>
      </div>
    );
  }

  return (
    <form onSubmit={handleSubmit} className="rounded-xl bg-white shadow-[0_4px_20px_rgba(0,0,0,0.06)] p-5 space-y-3">
      <h2 className="text-base font-bold text-brand">Complete Your Registration</h2>
      <p className="text-sm text-[#666]">
        {hasRole
          ? "Please fill in a few more details before continuing."
          : `Please fill in your info so the ${L.generalCoordinator} or System Admin can review and approve your access.`}
      </p>
      {error && <p className="text-sm text-[#dc3545]">{error}</p>}
      <Field label="Phone *">
        <input
          required
          type="tel"
          value={form.phone}
          onChange={(e) => field("phone", e.target.value)}
          className={inputClass}
        />
      </Field>
      <Field label="Gender *">
        <select
          required
          value={form.gender}
          onChange={(e) => field("gender", e.target.value as RegistrationInput["gender"])}
          className={inputClass}
        >
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
      {!hasRole && (
        <Field label="Comments">
          <textarea
            value={form.comments ?? ""}
            onChange={(e) => field("comments", e.target.value || null)}
            className={inputClass}
            rows={2}
          />
        </Field>
      )}
      <button
        type="submit"
        disabled={pending}
        className="w-full rounded-md bg-brand px-4 py-3 text-sm font-semibold text-white hover:bg-brand-dark disabled:opacity-60 shadow-[0_2px_4px_rgba(0,0,0,0.15)] transition-all hover:-translate-y-0.5 hover:shadow-[0_4px_8px_rgba(0,0,0,0.2)] active:translate-y-0 active:shadow-[0_1px_2px_rgba(0,0,0,0.15)]"
      >
        <BusyLabel busy={pending} busyText="Submitting…">
            Submit
          </BusyLabel>
      </button>
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
