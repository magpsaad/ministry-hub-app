"use client";

import { useState, useTransition } from "react";
import { refreshMinistrySettingsAction } from "@/app/console/actions";
import { BusyLabel } from "@/components/PendingButton";

/** Owner-approved (17 Oct 2026) -- the shared copy of every ministry's
 * settings is refreshed by each save in the app; this is for changes made
 * any other way. */
export function RefreshSettingsPanel() {
  const [pending, startTransition] = useTransition();
  const [result, setResult] = useState<string | null>(null);

  function refresh() {
    setResult(null);
    startTransition(async () => {
      const res = await refreshMinistrySettingsAction();
      setResult(res.error ?? `Done. Every ministry (${res.count}) will show its current settings on the next page open.`);
    });
  }

  return (
    <section className="rounded-xl bg-white shadow-[0_4px_20px_rgba(0,0,0,0.06)] p-5">
      <h2 className="text-lg font-bold text-brand mb-1">Refresh Ministry Settings</h2>
      <p className="text-sm text-[#666] mb-3">
        Each ministry&rsquo;s settings are kept in one shared copy, refreshed whenever they&rsquo;re saved in the app
        and at least once a day. If settings were changed any other way, refresh them here for everyone.
      </p>
      <div className="flex items-center gap-3">
        <button
          type="button"
          onClick={refresh}
          disabled={pending}
          className="rounded-md bg-brand px-4 py-1.5 text-xs font-semibold text-white hover:bg-brand-dark disabled:opacity-60"
        >
          <BusyLabel busy={pending} busyText="Refreshing…">
            Refresh ministry settings
          </BusyLabel>
        </button>
        {result && <span className="text-xs text-[#155724]">{result}</span>}
      </div>
    </section>
  );
}
