"use client";

import { useMemo, useState, useSyncExternalStore } from "react";
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

/** Owner-reported (15 Oct 2026): a Custom date couldn't be changed -- while a
 * date is being typed the box is briefly empty (or a year like "0002"), and
 * that half-typed value was saved, read back as "no date" and reset to the
 * 12-month default. The box now keeps what's being typed and only passes
 * on a complete date. */
function DateField({
  value,
  min,
  max,
  onCommit,
}: {
  value: string;
  min?: string;
  max?: string;
  onCommit: (date: string) => void;
}) {
  const [draft, setDraft] = useState(value);
  const [shown, setShown] = useState(value);
  if (value !== shown) {
    // Changed from outside (e.g. another sheet's choice): show it.
    setShown(value);
    setDraft(value);
  }
  return (
    <input
      type="date"
      value={draft}
      min={min}
      max={max}
      onChange={(e) => {
        const v = e.target.value;
        setDraft(v);
        if (/^\d{4}-\d{2}-\d{2}$/.test(v) && v >= "2000-01-01") onCommit(v);
      }}
      className={dateInput}
    />
  );
}

/** "Average attendance of: [Service | Events | Both]" and "For period:
 * [Last 12 months]", each label above its control, side by side; From/To
 * only for Custom. */
export function AverageControls({
  choice,
  onChange,
  today,
}: {
  choice: AvgChoice;
  onChange: (c: AvgChoice) => void;
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
          <span className="mb-1 block text-xs font-semibold text-[#555]">Average attendance of:</span>
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
            onChange={(e) => onChange({ ...choice, period: e.target.value as AvgPeriodKind })}
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
        <div className="flex flex-wrap items-center gap-2 text-sm text-[#333]">
          <label className="flex items-center gap-1.5">
            From
            <DateField value={choice.from} min={EARLIEST} max={choice.to || today} onCommit={(from) => onChange({ ...choice, from })} />
          </label>
          <label className="flex items-center gap-1.5">
            To
            <DateField value={choice.to} min={choice.from || EARLIEST} max={today} onCommit={(to) => onChange({ ...choice, to })} />
          </label>
        </div>
      )}
    </div>
  );
}
