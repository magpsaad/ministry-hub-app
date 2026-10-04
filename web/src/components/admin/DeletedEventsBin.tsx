"use client";

import { useState, useTransition } from "react";
import { restoreDeletedEventAction, type DeletedEvent } from "@/app/admin/calendar-maintenance/actions";
import { formatDateTimeInZone } from "@/lib/timezone";
import { useTimezone } from "@/components/TimezoneProvider";

/** Owner-approved (4 Oct 2026, migration 0082): deleted calendar events are
 * kept for 30 days; an Admin can put one back here. */
export function DeletedEventsBin({ initial }: { initial: DeletedEvent[] }) {
  const timeZone = useTimezone();
  const [events, setEvents] = useState(initial);
  const [pending, startTransition] = useTransition();
  const [message, setMessage] = useState<{ ok: boolean; text: string } | null>(null);

  function restore(e: DeletedEvent) {
    setMessage(null);
    startTransition(async () => {
      const res = await restoreDeletedEventAction(e.id);
      if (res.error) {
        setMessage({ ok: false, text: res.error });
        return;
      }
      setEvents((prev) => prev.filter((x) => x.id !== e.id));
      setMessage({ ok: true, text: `"${e.title}" is back on the calendar.` });
    });
  }

  return (
    <div className="rounded-xl bg-white shadow-[0_4px_20px_rgba(0,0,0,0.06)] p-5">
      <h2 className="text-lg font-bold text-brand">Recently Deleted Events</h2>
      <p className="mt-1 mb-3 text-xs text-[#666]">
        Deleted events are kept here for 30 days, then removed for good. Every add, edit and delete is also in Audit
        Logs.
      </p>
      {message && (
        <p className={`mb-2 text-sm ${message.ok ? "text-[#155724]" : "text-[#dc3545]"}`}>{message.text}</p>
      )}
      {events.length === 0 ? (
        <p className="text-sm text-[#666]">Nothing deleted in the last 30 days.</p>
      ) : (
        <ul className="divide-y divide-[#f0f0f0]">
          {events.map((e) => (
            <li key={e.id} className="flex items-center justify-between gap-3 py-2 text-sm">
              <div className="min-w-0">
                <p className="truncate font-medium text-[#333]">{e.title}</p>
                <p className="text-xs text-[#666]">
                  {e.start_date ? `Event date ${e.start_date} · ` : ""}deleted{" "}
                  {formatDateTimeInZone(e.deleted_at, timeZone, { month: "short", day: "numeric", hour: "numeric", minute: "2-digit" })}
                  {e.deleted_by_name ? ` by ${e.deleted_by_name}` : ""}
                </p>
              </div>
              <button
                type="button"
                onClick={() => restore(e)}
                disabled={pending}
                className="shrink-0 rounded-md bg-brand px-3 py-1.5 text-xs font-semibold text-white hover:bg-brand-dark disabled:opacity-60"
              >
                Restore
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
