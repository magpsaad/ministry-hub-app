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
            ). Please check the new registrations are real &mdash; each one is listed in{" "}
            <Link href="/admin/audit-logs" className="font-semibold text-brand underline">
              Audit Logs
            </Link>{" "}
            as CHECKIN_REGISTRATION.
          </p>
          <button
            type="button"
            onClick={() => markReviewed(a.id)}
            disabled={pending}
            className="mt-2 rounded-md bg-brand px-3 py-1.5 text-xs font-semibold text-white hover:bg-brand-dark disabled:opacity-60"
          >
            Mark reviewed
          </button>
        </div>
      ))}
      {error && <p className="text-sm text-[#dc3545]">{error}</p>}
    </div>
  );
}
