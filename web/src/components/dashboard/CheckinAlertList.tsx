"use client";

import Link from "next/link";
import { useState, useTransition } from "react";
import { reviewCheckinAlertAction } from "@/app/admin/checkin-alerts/actions";

export type CheckinAlert = { id: string; created_at: string; signups_last_hour: number };

export function CheckinAlertList({ alerts: initial, timeZone }: { alerts: CheckinAlert[]; timeZone?: string }) {
  const [alerts, setAlerts] = useState(initial);
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);

  if (alerts.length === 0) return null;

  function markReviewed(id: string) {
    if (
      !confirm(
        "Mark this alert reviewed? Do this only after checking the new sign-ups in Audit Logs -- the alert won't come back.",
      )
    )
      return;
    setError(null);
    startTransition(async () => {
      const res = await reviewCheckinAlertAction(id);
      if (res.error) {
        setError(res.error);
        return;
      }
      setAlerts((prev) => prev.filter((a) => a.id !== id));
    });
  }

  return (
    <div className="mt-4 space-y-2">
      {alerts.map((a) => (
        <div key={a.id} className="rounded-xl border-l-4 border-[#dc3545] bg-[#fdf2f3] p-4 shadow-[0_4px_20px_rgba(0,0,0,0.06)]">
          <p className="text-sm font-bold text-[#721c24]">Unusual number of check-in sign-ups</p>
          <p className="mt-1 text-sm text-[#333]">
            <strong>{a.signups_last_hour}</strong> people signed up through check-in posters within an hour (
            {new Date(a.created_at).toLocaleString(undefined, {
              weekday: "short",
              month: "short",
              day: "numeric",
              hour: "numeric",
              minute: "2-digit",
              timeZone,
            })}
            ).
          </p>
          <p className="mt-2 text-sm font-semibold text-[#721c24]">
            Please open Audit Logs and check that each new sign-up is a real person. Delete any that aren&rsquo;t.
          </p>
          <div className="mt-3 flex flex-wrap gap-2">
            <Link
              href="/admin/audit-logs?action=CHECKIN_REGISTRATION"
              className="rounded-md bg-brand px-4 py-2 text-sm font-semibold text-white hover:bg-brand-dark"
            >
              Open Audit Logs
            </Link>
            <button
              type="button"
              onClick={() => markReviewed(a.id)}
              disabled={pending}
              className="rounded-md border border-[#ccc] bg-white px-4 py-2 text-sm font-semibold text-[#555] hover:bg-[#f5f5f5] disabled:opacity-60"
            >
              Mark reviewed
            </button>
          </div>
        </div>
      ))}
      {error && <p className="text-sm text-[#dc3545]">{error}</p>}
    </div>
  );
}
