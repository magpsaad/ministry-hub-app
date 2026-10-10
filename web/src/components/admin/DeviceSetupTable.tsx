"use client";

import { useMemo, useState } from "react";

export type DeviceSetupRow = {
  user_id: string;
  full_name: string;
  home_icon: boolean;
  notifications: boolean;
  face_id: boolean;
};

type SortKey = "name" | "home_icon" | "notifications" | "face_id";

const COLUMNS: { key: Exclude<SortKey, "name">; label: string }[] = [
  { key: "home_icon", label: "Home icon" },
  { key: "notifications", label: "Notifications" },
  { key: "face_id", label: "Face ID" },
];

/** Audit Logs -> Device setup (owner-approved 10 Oct 2026, migration 0110):
 * everyone in the ministry, with a check mark for home screen icon,
 * notifications and Face ID; tap a heading to sort by it. */
export function DeviceSetupTable({ rows }: { rows: DeviceSetupRow[] }) {
  const [sortKey, setSortKey] = useState<SortKey>("name");
  const [asc, setAsc] = useState(true);

  const sorted = useMemo(() => {
    const byName = (a: DeviceSetupRow, b: DeviceSetupRow) => a.full_name.localeCompare(b.full_name);
    return [...rows].sort((a, b) => {
      if (sortKey === "name") return asc ? byName(a, b) : byName(b, a);
      // Ascending: blanks first (who still needs it), then by name.
      const diff = Number(a[sortKey]) - Number(b[sortKey]);
      return (asc ? diff : -diff) || byName(a, b);
    });
  }, [rows, sortKey, asc]);

  function sortBy(key: SortKey) {
    if (key === sortKey) setAsc((v) => !v);
    else {
      setSortKey(key);
      setAsc(true);
    }
  }

  const arrow = (key: SortKey) => (sortKey === key ? (asc ? " ▲" : " ▼") : "");
  const count = (key: Exclude<SortKey, "name">) => rows.filter((r) => r[key]).length;

  return (
    <div className="space-y-4">
      <div className="grid grid-cols-3 gap-3">
        {COLUMNS.map((c) => (
          <div key={c.key} className="rounded-xl bg-white p-3 shadow-[0_4px_20px_rgba(0,0,0,0.06)]">
            <p className="text-xs text-[#666]">{c.label}</p>
            <p className="text-xl font-bold text-[#333]">
              {count(c.key)} <span className="text-sm font-normal text-[#888]">of {rows.length}</span>
            </p>
          </div>
        ))}
      </div>

      <div className="overflow-x-auto rounded-xl bg-white shadow-[0_4px_20px_rgba(0,0,0,0.06)]">
        <table className="w-full text-sm">
          <thead>
            <tr className="bg-[#f5f5f5] text-[#666]">
              <th className="px-4 py-2 text-left font-semibold">
                <button type="button" onClick={() => sortBy("name")} className="hover:text-brand">
                  Name{arrow("name")}
                </button>
              </th>
              {COLUMNS.map((c) => (
                <th key={c.key} className="px-3 py-2 text-center font-semibold whitespace-nowrap">
                  <button type="button" onClick={() => sortBy(c.key)} className="hover:text-brand">
                    {c.label}
                    {arrow(c.key)}
                  </button>
                </th>
              ))}
            </tr>
          </thead>
          <tbody className="divide-y divide-[#f0f0f0]">
            {sorted.map((r) => (
              <tr key={r.user_id}>
                <td className="px-4 py-2.5 font-medium text-[#333]">{r.full_name}</td>
                {COLUMNS.map((c) => (
                  <td key={c.key} className="px-3 py-2.5 text-center">
                    {r[c.key] ? (
                      <span className="font-bold text-[#28a745]" aria-label="Yes">
                        ✓
                      </span>
                    ) : (
                      <span className="sr-only">No</span>
                    )}
                  </td>
                ))}
              </tr>
            ))}
            {rows.length === 0 && (
              <tr>
                <td colSpan={4} className="px-4 py-6 text-center text-[#666]">
                  No one to show.
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>

      <p className="text-xs text-[#888]">
        Home icon: opened the app from its home screen icon at least once (recorded from 10 Oct 2026). Notifications:
        turned on for this ministry on at least one device. Face ID: also counts fingerprint or device PIN unlock.
      </p>
    </div>
  );
}
