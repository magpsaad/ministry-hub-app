"use client";

import { useRef, useState } from "react";
import { setMinistryNotificationDefaultAction } from "@/app/admin/actions-needed-config/actions";
import { SpinnerIcon } from "@/components/icons";
import { useRoleLabels } from "@/components/RoleLabelsProvider";
import type { RoleLabels } from "@/lib/role-labels";

export type NotificationDefaultRow = {
  event: string;
  label: string;
  description: string;
  roles: string[];
  default_on: boolean;
  church_default: boolean;
};

function whoGetsIt(roles: string[], L: RoleLabels): string {
  return roles.includes("servant")
    ? `${L.servants}, ${L.coordinatorsLower}, ${L.gcs} and Admins`
    : `${L.gcs} and Admins`;
}

/** Ministry Settings -> Notification Defaults (owner-requested 6 Oct 2026,
 * migration 0096): whether each kind of notification starts on or off for
 * this ministry's people. Anyone who already chose in My Settings keeps
 * their choice. Each switch saves on tap and stays locked, with a spinner,
 * until it's saved. */
export function NotificationDefaultsCard({ rows }: { rows: NotificationDefaultRow[] }) {
  const L = useRoleLabels();
  const [on, setOn] = useState<Record<string, boolean>>(() => Object.fromEntries(rows.map((r) => [r.event, r.default_on])));
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const working = useRef(false);

  async function toggle(event: string) {
    if (working.current) return;
    working.current = true;
    const next = !on[event];
    setBusy(event);
    setError(null);
    setOn((o) => ({ ...o, [event]: next }));
    const res = await setMinistryNotificationDefaultAction(event, next);
    if (res.error) {
      setOn((o) => ({ ...o, [event]: !next }));
      setError(res.error);
    }
    setBusy(null);
    working.current = false;
  }

  return (
    <div className="rounded-xl bg-white shadow-[0_4px_20px_rgba(0,0,0,0.06)] p-5">
      <h2 className="text-lg font-bold text-brand mb-1">Notification Defaults</h2>
      <p className="text-sm text-[#666] mb-3">
        Whether each phone notification starts on or off for this ministry&rsquo;s {L.servantsLower}. Each person can still turn any
        of them on or off for themselves in My Settings &rarr; Notifications; anyone who already did keeps their own
        choice. Changes save straight away.
      </p>
      {error && <p className="mb-3 text-sm text-[#dc3545]">{error}</p>}
      <ul className="divide-y divide-[#f0f0f0]">
        {rows.map((r) => {
          const isOn = on[r.event];
          return (
            <li key={r.event} className="flex items-center justify-between gap-4 py-3">
              <span className="min-w-0">
                <span className="block text-sm font-semibold text-[#333]">{r.label}</span>
                <span className="block text-xs text-[#777]">{r.description}</span>
                <span className="block text-[11px] text-[#999]">For: {whoGetsIt(r.roles, L)}</span>
              </span>
              <span className="flex shrink-0 items-center gap-2">
                <span className={`text-xs font-semibold ${isOn ? "text-brand" : "text-[#888]"}`}>{isOn ? "On" : "Off"}</span>
                <button
                  type="button"
                  role="switch"
                  aria-checked={isOn}
                  aria-label={`${r.label} starts on`}
                  onClick={() => toggle(r.event)}
                  disabled={busy !== null}
                  className={`relative inline-flex h-7 w-12 items-center rounded-full transition-colors disabled:opacity-70 ${
                    isOn ? "bg-brand" : "bg-[#ccc]"
                  }`}
                >
                  <span
                    className={`inline-flex h-6 w-6 items-center justify-center rounded-full bg-white shadow transition-transform ${
                      isOn ? "translate-x-[22px]" : "translate-x-[2px]"
                    }`}
                  >
                    {busy === r.event && <SpinnerIcon className="h-4 w-4 text-brand" />}
                  </span>
                </button>
              </span>
            </li>
          );
        })}
      </ul>
    </div>
  );
}
