"use client";

import { useState } from "react";
import { resolveAttendanceSince } from "@/lib/attendance-window";
import { getMemberPresentDatesAction } from "@/app/g/[groupId]/members/data-actions";
import { AttendanceHistoryModal } from "./AttendanceHistoryModal";
import { useTimezone } from "@/components/TimezoneProvider";

/**
 * Owner-requested: the average-attendance % on a Member List card opens the
 * same per-date attendance history the Attendance tab already shows.
 *
 * The list only carries each member's computed %, not their dates, so this
 * fetches just this one member's present-dates when clicked (same on-demand
 * pattern as MemberDetailLink) and lists every tracked service-weekday date
 * from their join date onward (within the rolling window) -- built from the
 * exact date set the card's % was divided over, so the two always agree.
 */
export function MemberAttendanceLink({
  memberId,
  fullName,
  joinDate,
  serviceWeekdayDates,
  windowWeeks,
  title,
  className,
  children,
}: {
  memberId: string;
  fullName: string;
  joinDate: string | null;
  serviceWeekdayDates: string[];
  windowWeeks: number | null;
  /** Optional link back to the member's record, shown as the modal heading. */
  title?: React.ReactNode;
  className?: string;
  children: React.ReactNode;
}) {
  const timeZone = useTimezone();
  const [dates, setDates] = useState<{ date: string; present: boolean }[] | null>(null);
  const [loading, setLoading] = useState(false);

  async function open() {
    setLoading(true);
    const present = new Set(await getMemberPresentDatesAction(memberId));
    setLoading(false);
    const since = resolveAttendanceSince(joinDate, windowWeeks, timeZone);
    setDates(since ? serviceWeekdayDates.filter((d) => d >= since).map((d) => ({ date: d, present: present.has(d) })) : []);
  }

  return (
    <>
      <button type="button" onClick={open} disabled={loading} className={className}>
        {children}
      </button>
      {dates && <AttendanceHistoryModal fullName={fullName} title={title} dates={dates} onClose={() => setDates(null)} />}
    </>
  );
}
