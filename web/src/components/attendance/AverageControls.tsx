"use client";

import { useMemo, useSyncExternalStore } from "react";
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

const dateInput =
  "min-w-0 appearance-none rounded-md border border-[#ddd] bg-white px-2 py-1.5 text-sm focus:border-brand focus:outline-none";

/** "Average attendance of [Service | Events | Both] for period: [Last 12
 * months]" on one line, read as a sentence; From/To only for Custom. */
export function AverageControls({ choice, onChange }: { choice: AvgChoice; onChange: (c: AvgChoice) => void }) {
  return (
    <div className="space-y-2">
      {/* Two halves of one sentence, a space apart; on a narrow phone the
          second half moves under the first, each kept whole. */}
      <div className="flex flex-wrap items-center gap-x-5 gap-y-2 text-sm text-[#333]">
        <div className="flex items-center gap-2">
          <span className="font-semibold">Average attendance of</span>
          <div role="group" aria-label="Average attendance of" className="inline-flex overflow-hidden rounded-md border border-[#ddd]">
            {AVG_MODES.map((m) => (
              <button
                key={m.value}
                type="button"
                aria-pressed={choice.mode === m.value}
                onClick={() => onChange({ ...choice, mode: m.value as AvgMode })}
                className={`px-3 py-1.5 text-sm font-semibold transition-colors ${
                  choice.mode === m.value ? "bg-brand text-white" : "bg-white text-[#555] hover:bg-[#f5f5f5]"
                }`}
              >
                {m.label}
              </button>
            ))}
          </div>
        </div>
        <div className="flex items-center gap-2">
          <span className="font-semibold">For period:</span>
          <select
            aria-label="For period"
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
            <input
              type="date"
              value={choice.from}
              max={choice.to || undefined}
              onChange={(e) => onChange({ ...choice, from: e.target.value })}
              className={dateInput}
            />
          </label>
          <label className="flex items-center gap-1.5">
            To
            <input
              type="date"
              value={choice.to}
              min={choice.from || undefined}
              onChange={(e) => onChange({ ...choice, to: e.target.value })}
              className={dateInput}
            />
          </label>
        </div>
      )}
    </div>
  );
}
