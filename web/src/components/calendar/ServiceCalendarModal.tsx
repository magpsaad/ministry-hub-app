"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import Link from "next/link";
import type { CalendarEvent } from "@/lib/calendar-types";
import { EVENT_TYPE_COLORS, contrastText } from "@/lib/calendar-types";
import { AppLogo } from "@/components/AppLogo";
import { HomeIcon } from "@/components/icons";
import { RefreshButton } from "@/components/RefreshButton";
import { SignOutButton } from "@/components/SignOutButton";
import { EventForm } from "./EventForm";

type View = "month" | "week" | "list" | "fridays";

function toISO(d: Date): string {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

function addDays(d: Date, n: number): Date {
  const copy = new Date(d);
  copy.setDate(copy.getDate() + n);
  return copy;
}

function startOfWeek(d: Date): Date {
  const copy = new Date(d);
  copy.setHours(0, 0, 0, 0);
  copy.setDate(copy.getDate() - copy.getDay());
  return copy;
}

function monthGrid(cursor: Date): Date[] {
  const first = new Date(cursor.getFullYear(), cursor.getMonth(), 1);
  const start = startOfWeek(first);
  return Array.from({ length: 42 }, (_, i) => addDays(start, i));
}

/** Whether this specific date falls on the given ISO weekday (1=Monday ..
 * 7=Sunday) -- NOT "does some day in a multi-day event's range happen to
 * match" (owner-reported bug: the Fridays view used to check the latter,
 * so a multi-day event like a 2-week fast that merely touched a Friday
 * somewhere in its span made every day of it -- Saturdays, Holy Week's
 * other weekdays included -- show up on a view that's supposed to be
 * Fridays-only). */
function isServiceDay(date: Date, isoWeekday: number): boolean {
  const dow = date.getDay() === 0 ? 7 : date.getDay();
  return dow === isoWeekday;
}

function EventPill({ event, onClick }: { event: CalendarEvent; onClick: () => void }) {
  const bg = EVENT_TYPE_COLORS[event.event_type].color;
  return (
    <button
      type="button"
      onClick={(e) => {
        e.stopPropagation();
        onClick();
      }}
      className="max-w-full truncate rounded px-1.5 py-0.5 text-[11px] font-medium"
      style={{ backgroundColor: bg, color: contrastText(bg) }}
      title={event.title}
    >
      {event.title}
    </button>
  );
}

function DayGrid({
  days,
  currentMonth,
  eventsForDate,
  onDayClick,
  onEventClick,
}: {
  days: Date[];
  currentMonth?: number;
  eventsForDate: (dateISO: string) => CalendarEvent[];
  onDayClick: (dateISO: string) => void;
  onEventClick: (event: CalendarEvent) => void;
}) {
  const todayISO = toISO(new Date());
  return (
    <div className="grid grid-cols-7 gap-px bg-[#e0e0e0] rounded-lg overflow-hidden border border-[#e0e0e0]">
      {["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"].map((d) => (
        <div key={d} className="bg-[#f5f5f5] px-2 py-1.5 text-center text-xs font-semibold text-[#666]">
          {d}
        </div>
      ))}
      {days.map((day) => {
        const dateISO = toISO(day);
        const dimmed = currentMonth !== undefined && day.getMonth() !== currentMonth;
        const events = eventsForDate(dateISO);
        return (
          <div
            key={dateISO}
            onClick={() => onDayClick(dateISO)}
            className={`min-h-[90px] bg-white p-1.5 cursor-pointer hover:bg-[#f9f9f9] ${dimmed ? "opacity-40" : ""}`}
          >
            <span
              className={`text-xs font-semibold ${
                dateISO === todayISO ? "inline-flex h-5 w-5 items-center justify-center rounded-full bg-brand text-white" : "text-[#333]"
              }`}
            >
              {day.getDate()}
            </span>
            <div className="mt-1 space-y-0.5">
              {events.map((e) => (
                <EventPill key={e.id} event={e} onClick={() => onEventClick(e)} />
              ))}
            </div>
          </div>
        );
      })}
    </div>
  );
}

/** One row: date on the left, that date's events (or "No events") on the
 * right. Shared by Week (every day, even empty) and List/Fridays (only
 * dates that actually have events). */
function DateRow({
  date,
  events,
  showMonth,
  onDayClick,
  onEventClick,
  rowRef,
}: {
  date: Date;
  events: CalendarEvent[];
  showMonth: boolean;
  onDayClick: (dateISO: string) => void;
  onEventClick: (event: CalendarEvent) => void;
  rowRef?: (el: HTMLDivElement | null) => void;
}) {
  const dateISO = toISO(date);
  const isToday = dateISO === toISO(new Date());
  return (
    <div ref={rowRef} className={`flex border-b border-[#e0e0e0] ${isToday ? "bg-[#eef4fb]" : "bg-white"}`}>
      <div className={`w-20 shrink-0 px-2 py-3 text-center border-l-2 ${isToday ? "border-l-brand" : "border-l-transparent"}`}>
        <div className="text-[11px] uppercase text-[#666]">{date.toLocaleDateString(undefined, { weekday: "short" })}</div>
        <div className="text-lg font-bold text-[#333]">{date.getDate()}</div>
        {showMonth && (
          <div className="text-[10px] text-[#999]">
            {date.toLocaleDateString(undefined, { month: "short" })} {date.getFullYear()}
          </div>
        )}
      </div>
      <div
        className="flex-1 p-2 flex flex-wrap items-center gap-2 cursor-pointer hover:bg-[#f9f9f9]"
        onClick={() => onDayClick(dateISO)}
      >
        {events.length === 0 ? (
          <span className="text-sm text-[#999] italic">No events</span>
        ) : (
          events.map((e) => <EventPill key={e.id} event={e} onClick={() => onEventClick(e)} />)
        )}
      </div>
    </div>
  );
}

/** REQUIREMENTS.md §6.8 -- fullscreen modal, 4 views (Month/Week/List/the
 * deployment's actual service-day view). Event creation/editing/deletion is
 * open to all Servants (RLS enforces this regardless of the UI). */
export function ServiceCalendarModal({
  events,
  serviceWeekdayLabel,
  serviceWeekday,
  logoUrl,
  appTitleShort,
  appVersion,
  onClose,
  onRefresh,
}: {
  events: CalendarEvent[];
  serviceWeekdayLabel: string;
  serviceWeekday: number;
  logoUrl: string | null;
  appTitleShort: string;
  appVersion: string;
  onClose: () => void;
  onRefresh: () => void;
}) {
  const [view, setView] = useState<View>("month");
  const [cursor, setCursor] = useState(new Date());
  const [editingEvent, setEditingEvent] = useState<CalendarEvent | "new" | null>(null);
  const [newEventDate, setNewEventDate] = useState<string | undefined>(undefined);
  const rowRefs = useRef(new Map<string, HTMLDivElement>());

  const eventsForDate = useMemo(() => {
    return (dateISO: string) => events.filter((e) => dateISO >= e.start_date && dateISO <= e.end_date);
  }, [events]);

  function openNew(dateISO?: string) {
    setNewEventDate(dateISO);
    setEditingEvent("new");
  }

  function navigate(direction: -1 | 1) {
    setCursor((c) => (view === "week" ? addDays(c, 7 * direction) : new Date(c.getFullYear(), c.getMonth() + direction, 1)));
  }

  const monthLabel = cursor.toLocaleDateString(undefined, { month: "long", year: "numeric" });
  const weekDays = Array.from({ length: 7 }, (_, i) => addDays(startOfWeek(cursor), i));
  const weekLabel = `${weekDays[0].toLocaleDateString(undefined, { month: "short", day: "numeric" })} – ${weekDays[6].toLocaleDateString(undefined, { month: "short", day: "numeric" })}`;

  // Distinct dates that have >=1 event, sorted chronologically -- used by
  // both List (all) and Fridays (filtered) so they share the same agenda
  // row layout instead of the day-grid used by Month/Week.
  const listDates = useMemo(() => {
    const eventsByDate = new Map<string, CalendarEvent[]>();
    for (const e of events) {
      let d = new Date(`${e.start_date}T00:00:00`);
      const end = new Date(`${e.end_date}T00:00:00`);
      while (d.getTime() <= end.getTime()) {
        const iso = toISO(d);
        if (!eventsByDate.has(iso)) eventsByDate.set(iso, []);
        eventsByDate.get(iso)!.push(e);
        d = addDays(d, 1);
      }
    }
    return Array.from(eventsByDate.keys())
      .sort()
      .map((iso) => ({ date: new Date(`${iso}T00:00:00`), events: eventsByDate.get(iso)! }));
  }, [events]);

  const fridaysListDates = useMemo(
    () => listDates.filter((d) => isServiceDay(d.date, serviceWeekday)),
    [listDates, serviceWeekday],
  );

  // Auto-position List/Fridays to the current week on open/view-switch.
  useEffect(() => {
    if (view !== "list" && view !== "fridays") return;
    const todayISO = toISO(new Date());
    const source = view === "list" ? listDates : fridaysListDates;
    const target = source.find((d) => toISO(d.date) >= todayISO) ?? source[source.length - 1];
    if (target) {
      const el = rowRefs.current.get(toISO(target.date));
      el?.scrollIntoView({ block: "center" });
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [view]);

  return createPortal(
    <div className="fixed inset-0 z-[70] bg-[#f5f5f5] flex flex-col">
      <header className="bg-gradient-to-br from-brand to-brand-light text-white px-5 py-5 text-center shadow-[0_2px_10px_rgba(0,0,0,0.1)] relative shrink-0">
        <div className="absolute top-2.5 left-4 flex flex-col items-start gap-1">
          <button
            onClick={onClose}
            title="Home"
            aria-label="Home"
            className="inline-flex items-center gap-1 text-white/70 hover:text-white transition-colors"
          >
            <HomeIcon className="h-8 w-8" />
            <span className="text-xs font-medium">Home</span>
          </button>
          <RefreshButton onRefresh={onRefresh} />
        </div>
        <div className="absolute top-2.5 right-4 flex flex-col items-end gap-1">
          <SignOutButton className="text-white/70 hover:text-white transition-colors" />
          <span className="text-[10px] text-white/60">Version {appVersion}</span>
        </div>
        <Link href="/" className="inline-flex items-center justify-center gap-2 hover:opacity-90 transition-opacity">
          <AppLogo logoUrl={logoUrl} title={appTitleShort} size={32} circular={false} />
          <h1 className="text-2xl font-bold">{appTitleShort}</h1>
        </Link>
        <p className="mt-1 text-sm opacity-90">Service Calendar</p>
      </header>

      <div className="bg-white border-b border-[#ddd] px-4 py-2 flex flex-wrap items-center justify-between gap-2 shrink-0">
        <div className="flex gap-1">
          {(["month", "week", "list", "fridays"] as View[]).map((v) => (
            <button
              key={v}
              onClick={() => setView(v)}
              className={`rounded-md px-3 py-1.5 text-sm font-semibold ${
                view === v ? "bg-brand text-white" : "bg-[#f0f0f0] text-[#333] hover:bg-[#e0e0e0]"
              }`}
            >
              {v === "fridays" ? serviceWeekdayLabel : v.charAt(0).toUpperCase() + v.slice(1)}
            </button>
          ))}
        </div>
        {(view === "month" || view === "week") && (
          <div className="flex items-center gap-2">
            <button onClick={() => navigate(-1)} className="rounded-md bg-[#f0f0f0] px-2.5 py-1 text-sm hover:bg-[#e0e0e0]">
              ‹
            </button>
            <span className="text-sm font-semibold text-[#333] min-w-[140px] text-center">
              {view === "month" ? monthLabel : weekLabel}
            </span>
            <button onClick={() => navigate(1)} className="rounded-md bg-[#f0f0f0] px-2.5 py-1 text-sm hover:bg-[#e0e0e0]">
              ›
            </button>
            <button onClick={() => setCursor(new Date())} className="rounded-md bg-[#f0f0f0] px-3 py-1 text-xs font-semibold hover:bg-[#e0e0e0]">
              Today
            </button>
          </div>
        )}
        <button onClick={() => openNew()} className="rounded-md bg-brand px-3 py-1.5 text-sm font-semibold text-white hover:bg-brand-dark">
          + Add Event
        </button>
      </div>

      <div className="flex-1 overflow-y-auto p-4 max-w-5xl w-full mx-auto">
        {view === "month" && (
          <DayGrid
            days={monthGrid(cursor)}
            currentMonth={cursor.getMonth()}
            eventsForDate={eventsForDate}
            onDayClick={openNew}
            onEventClick={setEditingEvent}
          />
        )}
        {view === "week" && (
          <div className="rounded-lg overflow-hidden border border-[#e0e0e0]">
            {weekDays.map((day) => (
              <DateRow
                key={toISO(day)}
                date={day}
                events={eventsForDate(toISO(day))}
                showMonth={false}
                onDayClick={openNew}
                onEventClick={setEditingEvent}
              />
            ))}
          </div>
        )}
        {(view === "list" || view === "fridays") && (
          <div className="rounded-lg overflow-hidden border border-[#e0e0e0]">
            {(view === "list" ? listDates : fridaysListDates).map(({ date, events: dayEvents }) => (
              <DateRow
                key={toISO(date)}
                date={date}
                events={dayEvents}
                showMonth
                onDayClick={openNew}
                onEventClick={setEditingEvent}
                rowRef={(el) => {
                  if (el) rowRefs.current.set(toISO(date), el);
                  else rowRefs.current.delete(toISO(date));
                }}
              />
            ))}
            {(view === "list" ? listDates : fridaysListDates).length === 0 && (
              <p className="text-center text-sm text-[#666] py-8">No events to show.</p>
            )}
          </div>
        )}
      </div>

      {editingEvent !== null && (
        <EventForm
          event={editingEvent === "new" ? null : editingEvent}
          defaultDate={newEventDate}
          onClose={() => setEditingEvent(null)}
          onSaved={onRefresh}
        />
      )}
    </div>,
    document.body,
  );
}
