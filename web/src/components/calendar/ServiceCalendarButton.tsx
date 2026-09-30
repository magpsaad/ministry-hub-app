"use client";

import { useState, useTransition } from "react";
import type { CalendarEvent } from "@/lib/calendar-types";
import { getCalendarBootstrapAction, getCalendarEventsAction } from "@/app/calendar/actions";
import { ServiceCalendarModal } from "./ServiceCalendarModal";

/** Side-menu trigger for the Service Calendar (§6.8) -- fetches on first
 * open rather than on every page load, since the calendar is
 * ministry-wide, not scoped to whichever group happens to be loaded.
 * `className` replaces the default button styling; `onExit` also closes
 * whatever it was opened from (the side menu) when leaving the calendar
 * via Back or the logo. */
export function ServiceCalendarButton({ className, onExit }: { className?: string; onExit?: () => void }) {
  const [open, setOpen] = useState(false);
  const [events, setEvents] = useState<CalendarEvent[]>([]);
  // Real values arrive from App Settings on first open (the modal isn't
  // rendered before then), so these initial values are never shown.
  const [serviceWeekday, setServiceWeekday] = useState(0);
  const [serviceWeekdayLabel, setServiceWeekdayLabel] = useState("");
  const [branding, setBranding] = useState({ logoUrl: null as string | null, appTitleShort: "" });
  const [pending, startTransition] = useTransition();

  function handleOpen() {
    startTransition(async () => {
      const result = await getCalendarBootstrapAction();
      setEvents(result.events);
      setServiceWeekday(result.serviceWeekday);
      setServiceWeekdayLabel(result.serviceWeekdayLabel);
      setBranding({ logoUrl: result.logoUrl, appTitleShort: result.appTitleShort });
      setOpen(true);
    });
  }

  // Returns the promise so the modal's Refresh button can hold its spinner
  // until the events are back.
  async function handleRefresh() {
    setEvents(await getCalendarEventsAction());
  }

  return (
    <>
      <button
        type="button"
        onClick={handleOpen}
        disabled={pending}
        className={
          className ??
          "rounded-md bg-brand px-4 py-3 text-sm font-semibold text-white hover:bg-brand-dark disabled:opacity-60 shadow-[0_2px_4px_rgba(0,0,0,0.15)] transition-all hover:-translate-y-0.5 hover:shadow-[0_4px_8px_rgba(0,0,0,0.2)] active:translate-y-0 active:shadow-[0_1px_2px_rgba(0,0,0,0.15)]"
        }
      >
        {pending && !open ? "Loading…" : "Service Calendar"}
      </button>
      {open && (
        <ServiceCalendarModal
          events={events}
          serviceWeekday={serviceWeekday}
          serviceWeekdayLabel={serviceWeekdayLabel}
          logoUrl={branding.logoUrl}
          appTitleShort={branding.appTitleShort}
          onClose={() => setOpen(false)}
          onExit={() => {
            setOpen(false);
            onExit?.();
          }}
          onRefresh={handleRefresh}
        />
      )}
    </>
  );
}
