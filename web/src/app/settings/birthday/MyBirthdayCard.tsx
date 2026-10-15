"use client";

import { useState } from "react";
import { saveMyBirthdayAction } from "./actions";
import { BirthdayPicker } from "@/components/BirthdayPicker";
import { BusyLabel } from "@/components/PendingButton";
import { useRoleLabels } from "@/components/RoleLabelsProvider";

const selectClass =
  "w-full rounded-md border border-[#ddd] bg-white px-2 py-2 text-sm focus:border-brand focus:outline-none focus:ring-2 focus:ring-brand/10";

export function MyBirthdayCard({ initialMonth, initialDay }: { initialMonth: number | null; initialDay: number | null }) {
  const L = useRoleLabels();
  const [month, setMonth] = useState(initialMonth);
  const [day, setDay] = useState(initialDay);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);

  async function save(m: number | null, d: number | null) {
    if (busy) return;
    if ((m === null) !== (d === null)) {
      setError("Choose both a month and a day.");
      return;
    }
    setBusy(true);
    setError(null);
    setSaved(false);
    const result = await saveMyBirthdayAction(m, d);
    setBusy(false);
    if (result.error) {
      setError(result.error);
      return;
    }
    setMonth(m);
    setDay(d);
    setSaved(true);
  }

  return (
    <section className="rounded-xl bg-white shadow-[0_4px_20px_rgba(0,0,0,0.06)] p-5 space-y-3">
      <div>
        <h2 className="text-base font-bold text-brand">🎂 My Birthday</h2>
        <p className="text-sm text-[#666]">
          Just the day and month, no year. Your {L.coordinatorsLower} and {L.generalCoordinatorsLower} see it, so they can
          celebrate with you.
        </p>
      </div>
      {error && <p className="text-sm text-[#dc3545]">{error}</p>}
      <BirthdayPicker
        month={month}
        day={day}
        disabled={busy}
        onChange={(m, d) => {
          setMonth(m);
          setDay(d);
          setSaved(false);
        }}
        selectClassName={selectClass}
      />
      <div className="flex flex-wrap items-center gap-3">
        <button
          type="button"
          onClick={() => save(month, day)}
          disabled={busy}
          className="rounded-md bg-brand px-4 py-2 text-sm font-semibold text-white hover:bg-brand-dark disabled:opacity-60"
        >
          <BusyLabel busy={busy} busyText="Saving…">
            Save
          </BusyLabel>
        </button>
        {(initialMonth !== null || month !== null) && (
          <button
            type="button"
            onClick={() => save(null, null)}
            disabled={busy}
            className="rounded-md border border-[#ddd] bg-white px-3 py-2 text-sm font-semibold text-[#666] hover:bg-[#f5f5f5] disabled:opacity-60"
          >
            Remove
          </button>
        )}
        {saved && <span className="text-xs text-[#155724]">Saved.</span>}
      </div>
    </section>
  );
}
