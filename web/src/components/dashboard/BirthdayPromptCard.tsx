"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { saveMyBirthdayAction, snoozeBirthdayPromptAction } from "@/app/settings/birthday/actions";
import { BirthdayPicker } from "@/components/BirthdayPicker";
import { BusyLabel } from "@/components/PendingButton";
import { useRoleLabels } from "@/components/RoleLabelsProvider";

const selectClass =
  "w-full rounded-md border border-[#ddd] bg-white px-2 py-2 text-sm focus:border-brand focus:outline-none focus:ring-2 focus:ring-brand/10";

/** Owner-approved (15 Oct 2026, migration 0116): existing servants are
 * asked once, at the top of their Dashboard, for their birthday (day and
 * month). "Not now" asks again in 30 days; "No thanks" never asks again --
 * it can still be added in My Settings -> My Birthday. */
export function BirthdayPromptCard() {
  const L = useRoleLabels();
  const router = useRouter();
  const [month, setMonth] = useState<number | null>(null);
  const [day, setDay] = useState<number | null>(null);
  const [busy, setBusy] = useState<"save" | "later" | "never" | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [hidden, setHidden] = useState(false);
  const [saved, setSaved] = useState(false);

  if (hidden) return null;

  async function save() {
    if (busy) return;
    if (!month || !day) {
      setError("Choose both a month and a day.");
      return;
    }
    setBusy("save");
    setError(null);
    const result = await saveMyBirthdayAction(month, day);
    setBusy(null);
    if (result.error) {
      setError(result.error);
      return;
    }
    setSaved(true);
    window.setTimeout(() => {
      setHidden(true);
      router.refresh();
    }, 2000);
  }

  async function snooze(never: boolean) {
    if (busy) return;
    setBusy(never ? "never" : "later");
    const result = await snoozeBirthdayPromptAction(never);
    setBusy(null);
    if (result.error) {
      setError(result.error);
      return;
    }
    setHidden(true);
  }

  if (saved) {
    return (
      <section className="rounded-xl bg-[#e2f0d9] border-l-4 border-[#28a745] p-4 text-sm text-[#155724]">
        Thank you! 🎂 You can change it any time in My Settings &rarr; My Birthday.
      </section>
    );
  }

  return (
    <section className="rounded-xl bg-white shadow-[0_4px_20px_rgba(0,0,0,0.06)] border-l-4 border-[#28a745] p-4 space-y-3">
      <div>
        <h2 className="text-base font-bold text-brand">🎂 When is your birthday?</h2>
        <p className="text-sm text-[#666]">
          Add your birthday so your {L.coordinatorLower} and {L.generalCoordinatorsLower} can celebrate with you. Just the day
          and month, no year.
        </p>
      </div>
      {error && <p className="text-sm text-[#dc3545]">{error}</p>}
      <BirthdayPicker
        month={month}
        day={day}
        disabled={busy !== null}
        onChange={(m, d) => {
          setMonth(m);
          setDay(d);
        }}
        selectClassName={selectClass}
      />
      <div className="flex flex-wrap items-center gap-2">
        <button
          type="button"
          onClick={save}
          disabled={busy !== null}
          className="rounded-md bg-brand px-4 py-2 text-sm font-semibold text-white hover:bg-brand-dark disabled:opacity-60"
        >
          <BusyLabel busy={busy === "save"} busyText="Saving…">
            Save
          </BusyLabel>
        </button>
        <button
          type="button"
          onClick={() => snooze(false)}
          disabled={busy !== null}
          className="rounded-md border border-[#ddd] bg-white px-3 py-2 text-sm font-semibold text-[#666] hover:bg-[#f5f5f5] disabled:opacity-60"
        >
          <BusyLabel busy={busy === "later"} busyText="Not now">
            Not now
          </BusyLabel>
        </button>
        <button
          type="button"
          onClick={() => snooze(true)}
          disabled={busy !== null}
          className="rounded-md px-3 py-2 text-sm font-semibold text-[#999] hover:text-[#666] disabled:opacity-60"
        >
          <BusyLabel busy={busy === "never"} busyText="No thanks">
            No thanks
          </BusyLabel>
        </button>
      </div>
    </section>
  );
}
