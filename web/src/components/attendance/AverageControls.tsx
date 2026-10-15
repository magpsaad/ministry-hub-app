"use client";

import { useMemo, useRef, useState, useSyncExternalStore } from "react";
import {
  AVG_MODES,
  AVG_PERIODS,
  defaultAvgChoice,
  parseAvgChoice,
  serializeAvgChoice,
  type AvgChoice,
  type AvgMode,
  type AvgPeriodKind,
} from "@/lib/attendance-average";
import { shiftDateKey } from "@/lib/timezone";

const STORAGE_PREFIX = "attendance-average:";
const listeners = new Set<() => void>();
// This visit's choice too, so the switch still works where storage is blocked.
const memory = new Map<string, string>();
function subscribe(listener: () => void) {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

/** The sheet's average choice, remembered on this device per sheet
 * (owner-approved 10 Oct 2026). Read with useSyncExternalStore like
 * useSessionFlag; the default while the page hydrates. */
export function useAvgChoice(key: string, today: string): [AvgChoice, (c: AvgChoice) => void] {
  const raw = useSyncExternalStore(
    subscribe,
    () => {
      try {
        return memory.get(key) ?? localStorage.getItem(STORAGE_PREFIX + key);
      } catch {
        return memory.get(key) ?? null;
      }
    },
    () => null,
  );
  const choice = useMemo(() => (raw ? parseAvgChoice(raw, today) : defaultAvgChoice(today)), [raw, today]);
  function update(next: AvgChoice) {
    memory.set(key, serializeAvgChoice(next));
    try {
      localStorage.setItem(STORAGE_PREFIX + key, serializeAvgChoice(next));
    } catch {
      // Storage blocked: the choice just isn't remembered.
    }
    listeners.forEach((l) => l());
  }
  return [choice, update];
}

const EARLIEST = "2000-01-01";

const dateInput =
  "min-w-0 appearance-none rounded-md border border-[#ddd] bg-white px-2 py-1.5 text-sm focus:border-brand focus:outline-none";

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

function prettyDate(iso: string) {
  const [y, m, d] = iso.split("-").map(Number);
  return new Date(y, m - 1, d).toLocaleDateString(undefined, { month: "short", day: "numeric", year: "numeric" });
}

/** Owner-reported (15 Oct 2026), third pass: a Custom From/To change wasn't
 * taken at all on the owner's device. The boxes are now left to the browser
 * (no value pushed back into them while someone is choosing) and only read
 * when Apply is tapped; a line underneath says which dates are showing. */
function CustomRange({ from, to, today, onApply }: { from: string; to: string; today: string; onApply: (from: string, to: string) => void }) {
  const fromRef = useRef<HTMLInputElement>(null);
  const toRef = useRef<HTMLInputElement>(null);
  const [error, setError] = useState<string | null>(null);
  const [updated, setUpdated] = useState(false);

  function apply() {
    const f = fromRef.current?.value ?? "";
    const t = toRef.current?.value ?? "";
    if (!DATE_RE.test(f) || !DATE_RE.test(t) || f < EARLIEST || t < EARLIEST) {
      setError("Choose both a From and a To date.");
      return;
    }
    if (f > t) {
      setError("From must be on or before To.");
      return;
    }
    if (t > today) {
      setError("To can't be after today.");
      return;
    }
    setError(null);
    onApply(f, t);
    setUpdated(true);
    window.setTimeout(() => setUpdated(false), 2500);
  }

  return (
    <div className="space-y-1">
      <div className="flex flex-wrap items-center gap-2 text-sm text-[#333]">
        <label className="flex items-center gap-1.5">
          From
          <input key={`from-${from}`} ref={fromRef} type="date" defaultValue={from} min={EARLIEST} max={today} className={dateInput} />
        </label>
        <label className="flex items-center gap-1.5">
          To
          <input key={`to-${to}`} ref={toRef} type="date" defaultValue={to} min={EARLIEST} max={today} className={dateInput} />
        </label>
        <button
          type="button"
          onClick={apply}
          className="rounded-md bg-brand px-3 py-1.5 text-sm font-semibold text-white hover:bg-brand-dark"
        >
          Apply
        </button>
      </div>
      {error ? (
        <p className="text-xs text-[#dc3545]">{error}</p>
      ) : (
        <p className="text-xs text-[#666]">
          Showing {prettyDate(from)} &ndash; {prettyDate(to)}
          {updated && <span className="ml-1.5 font-semibold text-[#155724]">✓ Updated</span>}
        </p>
      )}
    </div>
  );
}

/** "Average attendance of: [Service | Events | Both]" and "For period:
 * [Last 12 months]", each label above its control, side by side; From/To
 * only for Custom. */
export function AverageControls({
  choice,
  onChange,
  today,
  info,
}: {
  choice: AvgChoice;
  onChange: (c: AvgChoice) => void;
  /** An (i) after "Average attendance of:" (owner-requested 15 Oct 2026,
   * Servant Attendance only for now). */
  info?: React.ReactNode;
  /** The latest day a Custom period can end on. Without a latest day, a
   * browser keeps taking digits into the year ("202609") instead of moving
   * on to the month (owner-reported, 15 Oct 2026). */
  today: string;
}) {
  return (
    <div className="space-y-2">
      {/* Owner's layout (10 Oct 2026): each label above its control, the two
          side by side with a space between. */}
      <div className="flex flex-wrap items-end gap-x-4 gap-y-2 text-sm text-[#333]">
        <div>
          <span className="mb-1 flex items-center gap-1 text-xs font-semibold text-[#555]">
            Average attendance of:
            {info}
          </span>
          <div role="group" aria-label="Average attendance of" className="inline-flex overflow-hidden rounded-md border border-[#ddd]">
            {AVG_MODES.map((m) => (
              <button
                key={m.value}
                type="button"
                aria-pressed={choice.mode === m.value}
                onClick={() => onChange({ ...choice, mode: m.value as AvgMode })}
                className={`px-2.5 py-1.5 text-sm font-semibold transition-colors ${
                  choice.mode === m.value ? "bg-brand text-white" : "bg-white text-[#555] hover:bg-[#f5f5f5]"
                }`}
              >
                {m.label}
              </button>
            ))}
          </div>
        </div>
        <div>
          <label htmlFor="average-period" className="mb-1 block text-xs font-semibold text-[#555]">
            For period:
          </label>
          <select
            id="average-period"
            value={choice.period}
            onChange={(e) => {
              const period = e.target.value as AvgPeriodKind;
              // Owner-requested (15 Oct 2026): choosing Custom starts at the
              // last month (a pre-filled date a year back was easy to keep
              // by mistake).
              onChange(period === "custom" ? { ...choice, period, from: shiftDateKey(today, { months: -1 }), to: today } : { ...choice, period });
            }}
            className="rounded-md border border-[#ddd] bg-white px-2 py-1.5 text-sm focus:border-brand focus:outline-none"
          >
            {AVG_PERIODS.map((p) => (
              <option key={p.value} value={p.value}>
                {p.label}
              </option>
            ))}
          </select>
        </div>
      </div>
      {choice.period === "custom" && (
        <CustomRange from={choice.from} to={choice.to} today={today} onApply={(from, to) => onChange({ ...choice, from, to })} />
      )}
    </div>
  );
}
