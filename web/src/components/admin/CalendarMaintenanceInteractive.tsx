"use client";

import { useMemo, useState, useTransition } from "react";
import {
  computeHolidaysForYear,
  computeCanadianHolidaysForYear,
  computeCustomHolidaysForYear,
  type HolidayRule,
} from "@/lib/holidays";
import {
  preloadHolidaysAction,
  addHolidayRuleAction,
  deleteHolidayRuleAction,
  toggleHolidayRuleAction,
} from "@/app/admin/calendar-maintenance/actions";

const MONTHS = [
  "January", "February", "March", "April", "May", "June",
  "July", "August", "September", "October", "November", "December",
];

export function CalendarMaintenanceInteractive({
  defaultYear,
  initialRules,
}: {
  defaultYear: number;
  initialRules: HolidayRule[];
}) {
  const [year, setYear] = useState(defaultYear);
  const [includeCoptic, setIncludeCoptic] = useState(true);
  const [includeCanadian, setIncludeCanadian] = useState(true);
  const [rules, setRules] = useState(initialRules);
  const [pending, startTransition] = useTransition();
  const [rulePending, startRuleTransition] = useTransition();
  const [result, setResult] = useState<{ inserted: number; skipped: number } | null>(null);
  const [error, setError] = useState<string | null>(null);

  const [newTitle, setNewTitle] = useState("");
  const [newBasis, setNewBasis] = useState<"fixed" | "pascha">("fixed");
  const [newMonth, setNewMonth] = useState(1);
  const [newDay, setNewDay] = useState(1);
  const [newOffset, setNewOffset] = useState(0);
  const [newDuration, setNewDuration] = useState(1);
  const [ruleError, setRuleError] = useState<string | null>(null);

  const preview = useMemo(() => {
    const combined = [
      ...(includeCoptic ? computeHolidaysForYear(year) : []),
      ...(includeCanadian ? computeCanadianHolidaysForYear(year) : []),
      ...computeCustomHolidaysForYear(year, rules),
    ];
    return combined.sort((a, b) => a.startDate.localeCompare(b.startDate));
  }, [year, includeCoptic, includeCanadian, rules]);

  function handlePreload() {
    setError(null);
    setResult(null);
    startTransition(async () => {
      const res = await preloadHolidaysAction(year, { includeCoptic, includeCanadian });
      if (res.error) {
        setError(res.error);
        return;
      }
      setResult({ inserted: res.inserted, skipped: res.skipped });
    });
  }

  function handleAddRule() {
    setRuleError(null);
    if (!newTitle.trim()) {
      setRuleError("Title is required.");
      return;
    }
    startRuleTransition(async () => {
      const res = await addHolidayRuleAction({
        title: newTitle.trim(),
        basis: newBasis,
        startMonth: newBasis === "fixed" ? newMonth : null,
        startDay: newBasis === "fixed" ? newDay : null,
        startOffset: newBasis === "pascha" ? newOffset : null,
        durationDays: newDuration,
      });
      if (res.error) {
        setRuleError(res.error);
        return;
      }
      setRules((prev) => [
        ...prev,
        {
          id: crypto.randomUUID(),
          title: newTitle.trim(),
          basis: newBasis,
          start_month: newBasis === "fixed" ? newMonth : null,
          start_day: newBasis === "fixed" ? newDay : null,
          start_offset: newBasis === "pascha" ? newOffset : null,
          duration_days: newDuration,
          is_active: true,
        },
      ]);
      setNewTitle("");
      setNewDuration(1);
    });
  }

  function handleDeleteRule(id: string) {
    setRules((prev) => prev.filter((r) => r.id !== id));
    startRuleTransition(async () => {
      await deleteHolidayRuleAction(id);
    });
  }

  function handleToggleRule(id: string, isActive: boolean) {
    setRules((prev) => prev.map((r) => (r.id === id ? { ...r, is_active: isActive } : r)));
    startRuleTransition(async () => {
      await toggleHolidayRuleAction(id, isActive);
    });
  }

  return (
    <div className="space-y-4">
      <div className="rounded-xl bg-white shadow-[0_4px_20px_rgba(0,0,0,0.06)] p-5">
        <h2 className="text-lg font-bold text-brand mb-3">Preload Holidays &amp; Feast Days</h2>
        <p className="text-sm text-[#666] mb-3">
          Computes the sets below for the selected year (fixed feasts, Pascha-relative movable feasts, and any
          custom feasts/fasts you&rsquo;ve added, all calculated algorithmically). Review the preview before adding
          it to the calendar.
        </p>
        <div className="flex flex-wrap items-center gap-4 mb-3">
          <label className="flex items-center gap-2 text-sm text-[#333]">
            <input type="checkbox" checked={includeCoptic} onChange={(e) => setIncludeCoptic(e.target.checked)} />
            Coptic Orthodox feasts
          </label>
          <label className="flex items-center gap-2 text-sm text-[#333]">
            <input type="checkbox" checked={includeCanadian} onChange={(e) => setIncludeCanadian(e.target.checked)} />
            Canadian statutory holidays
          </label>
        </div>
        <div className="flex items-center gap-2">
          <label className="text-sm font-semibold text-[#333]">Year</label>
          <input
            type="number"
            value={year}
            onChange={(e) => setYear(Number(e.target.value))}
            className="w-28 rounded-md border border-[#ddd] px-3 py-2 text-sm focus:border-brand focus:outline-none"
          />
          <button
            type="button"
            onClick={handlePreload}
            disabled={pending}
            className="rounded-md bg-brand px-4 py-2 text-sm font-semibold text-white hover:bg-brand-dark disabled:opacity-60 shadow-[0_2px_4px_rgba(0,0,0,0.15)] transition-all hover:-translate-y-0.5 hover:shadow-[0_4px_8px_rgba(0,0,0,0.2)] active:translate-y-0 active:shadow-[0_1px_2px_rgba(0,0,0,0.15)]"
          >
            {pending ? "Adding…" : `Add ${year} Holidays to Calendar`}
          </button>
        </div>
        {error && <p className="mt-3 text-sm text-[#dc3545]">{error}</p>}
        {result && (
          <p className="mt-3 text-sm text-[#155724]">
            Added {result.inserted} new holiday{result.inserted === 1 ? "" : "s"}
            {result.skipped > 0 ? ` (${result.skipped} already existed and were skipped).` : "."}
          </p>
        )}
      </div>

      <div className="rounded-xl bg-white shadow-[0_4px_20px_rgba(0,0,0,0.06)] p-5">
        <h3 className="text-sm font-bold text-brand mb-3">Preview for {year}</h3>
        <div className="divide-y divide-[#f0f0f0]">
          {preview.map((h) => (
            <div key={`${h.title}-${h.startDate}`} className="py-2 flex items-center justify-between text-sm">
              <span className="text-[#333]">{h.title}</span>
              <span className="text-[#666]">{h.startDate === h.endDate ? h.startDate : `${h.startDate} – ${h.endDate}`}</span>
            </div>
          ))}
          {preview.length === 0 && <p className="py-2 text-sm text-[#666]">Nothing selected.</p>}
        </div>
      </div>

      <div className="rounded-xl bg-white shadow-[0_4px_20px_rgba(0,0,0,0.06)] p-5">
        <h3 className="text-sm font-bold text-brand mb-1">Custom Feasts &amp; Fasts</h3>
        <p className="text-xs text-[#666] mb-3">
          Add a feast or fast (e.g. St. Mary&rsquo;s Fast) and its date will be computed automatically every year --
          either a fixed date, or a number of days relative to that year&rsquo;s Pascha, optionally spanning multiple
          days. <strong>These are separate from the two checkboxes above</strong> -- each one is included or excluded
          using its own checkbox below, not by the &ldquo;Coptic Orthodox feasts&rdquo; toggle, even if it&rsquo;s a
          Coptic observance.
        </p>

        <div className="divide-y divide-[#f0f0f0] mb-4">
          {rules.map((r) => (
            <div key={r.id} className="py-2 flex items-center justify-between gap-3 text-sm">
              <label className="flex items-center gap-2 flex-1 min-w-0">
                <input
                  type="checkbox"
                  checked={r.is_active}
                  onChange={(e) => handleToggleRule(r.id, e.target.checked)}
                />
                <span className={`truncate ${r.is_active ? "text-[#333]" : "text-[#aaa] line-through"}`}>
                  {r.title}
                </span>
              </label>
              <span className="text-xs text-[#666] whitespace-nowrap">
                {r.basis === "fixed"
                  ? `${MONTHS[r.start_month! - 1]} ${r.start_day}`
                  : `Pascha ${r.start_offset! >= 0 ? "+" : ""}${r.start_offset}d`}
                {r.duration_days > 1 ? ` (${r.duration_days}d)` : ""}
              </span>
              <button
                type="button"
                onClick={() => handleDeleteRule(r.id)}
                disabled={rulePending}
                className="text-[#dc3545] hover:text-[#a71d2a] text-xs font-semibold disabled:opacity-60"
              >
                Delete
              </button>
            </div>
          ))}
          {rules.length === 0 && <p className="py-2 text-sm text-[#666]">No custom feasts/fasts yet.</p>}
        </div>

        <div className="border-t border-[#f0f0f0] pt-3 space-y-2">
          <input
            type="text"
            placeholder="Title (e.g. St. Mary's Fast)"
            value={newTitle}
            onChange={(e) => setNewTitle(e.target.value)}
            className="w-full rounded-md border border-[#ddd] px-3 py-2 text-sm focus:border-brand focus:outline-none"
          />
          <div className="flex flex-wrap items-center gap-2">
            <select
              value={newBasis}
              onChange={(e) => setNewBasis(e.target.value as "fixed" | "pascha")}
              className="rounded-md border border-[#ddd] px-2 py-2 text-sm focus:border-brand focus:outline-none"
            >
              <option value="fixed">Fixed date</option>
              <option value="pascha">Relative to Pascha</option>
            </select>

            {newBasis === "fixed" ? (
              <>
                <select
                  value={newMonth}
                  onChange={(e) => setNewMonth(Number(e.target.value))}
                  className="rounded-md border border-[#ddd] px-2 py-2 text-sm focus:border-brand focus:outline-none"
                >
                  {MONTHS.map((m, i) => (
                    <option key={m} value={i + 1}>
                      {m}
                    </option>
                  ))}
                </select>
                <input
                  type="number"
                  min={1}
                  max={31}
                  value={newDay}
                  onChange={(e) => setNewDay(Number(e.target.value))}
                  className="w-16 rounded-md border border-[#ddd] px-2 py-2 text-sm focus:border-brand focus:outline-none"
                />
              </>
            ) : (
              <div className="flex items-center gap-1">
                <span className="text-xs text-[#666]">Offset (days)</span>
                <input
                  type="number"
                  value={newOffset}
                  onChange={(e) => setNewOffset(Number(e.target.value))}
                  className="w-20 rounded-md border border-[#ddd] px-2 py-2 text-sm focus:border-brand focus:outline-none"
                />
              </div>
            )}

            <div className="flex items-center gap-1">
              <span className="text-xs text-[#666]">Duration (days)</span>
              <input
                type="number"
                min={1}
                value={newDuration}
                onChange={(e) => setNewDuration(Number(e.target.value))}
                className="w-16 rounded-md border border-[#ddd] px-2 py-2 text-sm focus:border-brand focus:outline-none"
              />
            </div>

            <button
              type="button"
              onClick={handleAddRule}
              disabled={rulePending}
              className="rounded-md bg-brand px-4 py-2 text-sm font-semibold text-white hover:bg-brand-dark disabled:opacity-60 shadow-[0_2px_4px_rgba(0,0,0,0.15)] transition-all hover:-translate-y-0.5 hover:shadow-[0_4px_8px_rgba(0,0,0,0.2)] active:translate-y-0 active:shadow-[0_1px_2px_rgba(0,0,0,0.15)]"
            >
              Add
            </button>
          </div>
          {ruleError && <p className="text-sm text-[#dc3545]">{ruleError}</p>}
        </div>
      </div>
    </div>
  );
}
