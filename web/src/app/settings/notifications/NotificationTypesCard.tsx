"use client";

import { useRef, useState } from "react";
import { setNotificationPreference } from "./actions";
import { CARD } from "@/app/security/shared";
import { SpinnerIcon } from "@/components/icons";

export type NotificationTypeRow = { event: string; label: string; description: string; enabled: boolean };

/** My Settings -> Notifications -> "What to notify me about" (migration
 * 0094): one switch per kind of notification that can reach this person
 * in this ministry -- kinds for other roles are never listed. Each switch
 * saves on tap and stays locked, with a spinner, until it's saved. */
export function NotificationTypesCard({ rows }: { rows: NotificationTypeRow[] }) {
  const [enabled, setEnabled] = useState<Record<string, boolean>>(() =>
    Object.fromEntries(rows.map((r) => [r.event, r.enabled])),
  );
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const working = useRef(false);

  async function toggle(event: string) {
    if (working.current) return;
    working.current = true;
    const next = !enabled[event];
    setBusy(event);
    setError(null);
    setEnabled((e) => ({ ...e, [event]: next }));
    const res = await setNotificationPreference(event, next);
    if (res.error) {
      setEnabled((e) => ({ ...e, [event]: !next }));
      setError(res.error);
    }
    setBusy(null);
    working.current = false;
  }

  return (
    <div className={CARD}>
      <h2 className="text-base font-bold text-[#333]">What to notify me about</h2>
      {rows.length === 0 ? (
        <p className="mt-1 text-sm text-[#555]">
          There are no notifications for your role yet. New ones will show up here for you to choose.
        </p>
      ) : (
        <>
          <p className="mt-1 text-sm text-[#555]">Applies to every device you turned notifications on for.</p>
          <ul className="mt-3 divide-y divide-[#f0f0f0]">
            {rows.map((r) => {
              const on = enabled[r.event];
              return (
                <li key={r.event} className="flex items-center justify-between gap-4 py-3">
                  <span className="min-w-0">
                    <span className="block text-sm font-semibold text-[#333]">{r.label}</span>
                    <span className="block text-xs text-[#777]">{r.description}</span>
                  </span>
                  <button
                    type="button"
                    role="switch"
                    aria-checked={on}
                    aria-label={r.label}
                    onClick={() => toggle(r.event)}
                    disabled={busy !== null}
                    className={`relative inline-flex h-7 w-12 shrink-0 items-center rounded-full transition-colors disabled:opacity-70 ${
                      on ? "bg-brand" : "bg-[#ccc]"
                    }`}
                  >
                    <span
                      className={`inline-flex h-6 w-6 items-center justify-center rounded-full bg-white shadow transition-transform ${
                        on ? "translate-x-[22px]" : "translate-x-[2px]"
                      }`}
                    >
                      {busy === r.event && <SpinnerIcon className="h-4 w-4 text-brand" />}
                    </span>
                  </button>
                </li>
              );
            })}
          </ul>
        </>
      )}
      {error && <p className="mt-3 rounded-md bg-[#f8d7da] px-3 py-2 text-sm text-[#721c24]">{error}</p>}
    </div>
  );
}
