"use client";

import { useState } from "react";
import type { ServantAttendanceMember } from "@/lib/servant-attendance";
import { useRoleLabels } from "@/components/RoleLabelsProvider";
import { ChevronDownIcon } from "@/components/icons";

/** Owner-requested (15 Oct 2026): how many servants came each week -- the
 * last service day in words, the last 8 as small bars, and (for General
 * Coordinators and Admins) one line per group. Someone counts from the day
 * they joined; General Coordinators without a Servant grant aren't counted. */

const WEEKS = 8;

function shortDate(iso: string) {
  const [y, m, d] = iso.split("-").map(Number);
  return new Date(y, m - 1, d).toLocaleDateString(undefined, { month: "short", day: "numeric" });
}

function tally(members: ServantAttendanceMember[], attendance: Record<string, string[]>, date: string) {
  const counted = members.filter((m) => m.countFrom !== null && m.countFrom <= date);
  const present = counted.filter((m) => (attendance[m.id] ?? []).includes(date)).length;
  return { present, counted: counted.length };
}

export function ServantWeeklyStrip({
  members,
  attendanceByServant,
  serviceDates,
  groupNames,
  showGroups,
}: {
  members: ServantAttendanceMember[];
  attendanceByServant: Record<string, string[]>;
  /** Ascending service-weekday dates attendance was taken on. */
  serviceDates: string[];
  groupNames: Record<string, string>;
  showGroups: boolean;
}) {
  const L = useRoleLabels();
  const [groupsOpen, setGroupsOpen] = useState(false);
  const people = members.filter((m) => !m.gcOnly);
  const dates = serviceDates.slice(-WEEKS);
  if (dates.length === 0 || people.length === 0) return null;

  const last = dates[dates.length - 1];
  const lastTally = tally(people, attendanceByServant, last);
  const weeks = dates.map((d) => ({ date: d, ...tally(people, attendanceByServant, d) }));

  const groups = [
    ...Object.entries(groupNames).map(([id, name]) => ({ key: id, name, rows: people.filter((m) => m.groupIds.includes(id)) })),
    { key: "unassigned", name: "Unassigned", rows: people.filter((m) => m.groupIds.length === 0) },
  ].filter((g) => g.rows.length > 0);

  return (
    <section className="rounded-xl bg-white shadow-[0_4px_20px_rgba(0,0,0,0.06)] p-4">
      <p className="text-sm text-[#333]">
        Last week ({shortDate(last)}): <strong>{lastTally.present}</strong> of {lastTally.counted} {L.servantsLower} present
      </p>
      <div className="mt-3 flex items-end gap-1.5" aria-label={`${L.servants} present, last ${weeks.length} weeks`}>
        {weeks.map((w) => {
          const pct = w.counted > 0 ? Math.round((w.present / w.counted) * 100) : 0;
          return (
            <div key={w.date} className="flex min-w-0 flex-1 flex-col items-center gap-1" title={`${shortDate(w.date)}: ${w.present} of ${w.counted}`}>
              <span className="text-[10px] font-semibold text-[#666]">{w.present}</span>
              <div className="flex h-12 w-full items-end rounded bg-[#f0f0f0]">
                <div className="w-full rounded bg-brand" style={{ height: `${Math.max(pct, 2)}%` }} />
              </div>
              <span className="overflow-hidden whitespace-nowrap text-[9px] text-[#999]">{shortDate(w.date)}</span>
            </div>
          );
        })}
      </div>
      {showGroups && groups.length > 0 && (
        <div className="mt-3 border-t border-[#f0f0f0] pt-2">
          <button
            type="button"
            onClick={() => setGroupsOpen((o) => !o)}
            aria-expanded={groupsOpen}
            className="flex w-full items-center justify-between text-left text-xs font-semibold text-brand"
          >
            By group, last week
            <ChevronDownIcon className={`h-4 w-4 text-[#999] transition-transform ${groupsOpen ? "rotate-180" : ""}`} />
          </button>
          {groupsOpen && (
            <div className="mt-2 divide-y divide-[#f5f5f5]">
              {groups.map((g) => {
                const t = tally(g.rows, attendanceByServant, last);
                return (
                  <div key={g.key} className="flex items-center justify-between gap-3 py-1.5 text-xs">
                    <span className="min-w-0 overflow-hidden whitespace-nowrap text-[#333]">{g.name}</span>
                    <span className="shrink-0 text-[#666]">
                      <strong className="text-[#333]">{t.present}</strong> of {t.counted}
                    </span>
                  </div>
                );
              })}
            </div>
          )}
        </div>
      )}
    </section>
  );
}
