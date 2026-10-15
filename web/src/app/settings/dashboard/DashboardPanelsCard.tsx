"use client";

import { useState } from "react";
import { setDashboardPrefAction } from "./actions";
import { SpinnerIcon } from "@/components/icons";
import type { DashboardPanel } from "@/lib/dashboard-prefs";

type PanelRow = { panel: DashboardPanel; name: string; startOpen: boolean };

export function DashboardPanelsCard({ panels, overviewName }: { panels: PanelRow[]; overviewName: string }) {
  const [rows, setRows] = useState(panels);
  const [busy, setBusy] = useState<DashboardPanel | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function choose(panel: DashboardPanel, open: boolean) {
    if (busy) return;
    const current = rows.find((r) => r.panel === panel);
    if (!current || current.startOpen === open) return;
    setBusy(panel);
    setError(null);
    const result = await setDashboardPrefAction(panel, open);
    setBusy(null);
    if (result.error) {
      setError(result.error);
      return;
    }
    setRows((prev) => prev.map((r) => (r.panel === panel ? { ...r, startOpen: open } : r)));
  }

  return (
    <section className="rounded-xl bg-white shadow-[0_4px_20px_rgba(0,0,0,0.06)] p-5">
      <h2 className="text-base font-bold text-brand">Dashboard panels</h2>
      <p className="mt-1 text-sm text-[#666]">
        Choose whether each panel starts expanded or collapsed when you sign in. You can still expand or collapse a
        panel by tapping its title; the app remembers that until you sign out or close the app. The {overviewName} is
        always expanded.
      </p>
      {error && <p className="mt-3 text-sm text-[#dc3545]">{error}</p>}
      <div className="mt-4 divide-y divide-[#f0f0f0]">
        {rows.map((r) => (
          <div key={r.panel} className="flex items-center justify-between gap-3 py-3">
            <span className="min-w-0 text-sm font-semibold text-[#333]">{r.name}</span>
            <div className="flex shrink-0 items-center gap-2">
              {busy === r.panel && <SpinnerIcon className="h-4 w-4 text-brand" />}
              <div className="inline-flex rounded-md border border-[#ddd] p-0.5" role="group" aria-label={`${r.name} starts`}>
                {(
                  [
                    [true, "Expanded"],
                    [false, "Collapsed"],
                  ] as const
                ).map(([open, label]) => (
                  <button
                    key={label}
                    type="button"
                    disabled={busy !== null}
                    aria-pressed={r.startOpen === open}
                    onClick={() => choose(r.panel, open)}
                    className={`rounded px-2.5 py-1 text-xs font-semibold disabled:opacity-60 ${
                      r.startOpen === open ? "bg-brand text-white" : "text-[#666] hover:bg-[#f5f5f5]"
                    }`}
                  >
                    {label}
                  </button>
                ))}
              </div>
            </div>
          </div>
        ))}
      </div>
    </section>
  );
}
