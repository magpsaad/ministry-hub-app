"use client";

import { MONTH_NAMES, daysInMonth } from "@/lib/birthday";

/** Month and day dropdowns for a servant's birthday (no year). */
export function BirthdayPicker({
  month,
  day,
  onChange,
  disabled = false,
  selectClassName,
}: {
  month: number | null;
  day: number | null;
  onChange: (month: number | null, day: number | null) => void;
  disabled?: boolean;
  selectClassName: string;
}) {
  const days = month ? daysInMonth(month) : 31;
  return (
    <div className="flex gap-2">
      <select
        aria-label="Birthday month"
        value={month ?? ""}
        disabled={disabled}
        onChange={(e) => {
          const m = e.target.value ? Number(e.target.value) : null;
          onChange(m, m && day && day > daysInMonth(m) ? null : day);
        }}
        className={`${selectClassName} flex-[2]`}
      >
        <option value="">Month</option>
        {MONTH_NAMES.map((name, i) => (
          <option key={name} value={i + 1}>
            {name}
          </option>
        ))}
      </select>
      <select
        aria-label="Birthday day"
        value={day ?? ""}
        disabled={disabled}
        onChange={(e) => onChange(month, e.target.value ? Number(e.target.value) : null)}
        className={`${selectClassName} flex-1`}
      >
        <option value="">Day</option>
        {Array.from({ length: days }, (_, i) => i + 1).map((d) => (
          <option key={d} value={d}>
            {d}
          </option>
        ))}
      </select>
    </div>
  );
}
