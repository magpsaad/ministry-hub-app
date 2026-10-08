"use client";

import { useMemo, useState, useTransition } from "react";
import type { ServantAttendanceBundle } from "@/lib/servant-attendance";
import { resolveAttendanceSince } from "@/lib/attendance-window";
import { setServantAttendanceAction } from "@/app/servants-attendance/actions";
import { AttendanceHistoryModal } from "@/components/attendance/AttendanceHistoryModal";
import { useTimezone } from "@/components/TimezoneProvider";
import { useRoleLabels } from "@/components/RoleLabelsProvider";

function formatDate(iso: string): string {
  const [y, m, d] = iso.split("-").map(Number);
  return new Date(y, m - 1, d).toLocaleDateString(undefined, { month: "short", day: "numeric", year: "numeric" });
}

/** REQUIREMENTS.md §6.13 -- same Present/Absent/"Never Attended" pattern as
 * the member Attendance tab (§6.5), applied to servants across the whole
 * ministry (not scoped to one group). */
export function ServantsAttendanceInteractive({
  bundle,
  windowWeeks,
  dayName,
}: {
  bundle: ServantAttendanceBundle;
  windowWeeks: number | null;
  dayName: string;
}) {
  const L = useRoleLabels();
  const timeZone = useTimezone();
  const [attendanceByServant, setAttendanceByServant] = useState(bundle.attendanceByServant);
  const [togglingId, setTogglingId] = useState<string | null>(null);
  const [search, setSearch] = useState("");
  const [, startTransition] = useTransition();
  const [sortKey, setSortKey] = useState<"name" | "group" | "attendance" | "status">("name");
  const [sortDir, setSortDir] = useState<"asc" | "desc">("asc");
  const [historyMember, setHistoryMember] = useState<{ id: string; full_name: string } | null>(null);

  function historyFor(servantId: string, joinDate: string | null) {
    const since = resolveAttendanceSince(joinDate, bundle.windowWeeks, timeZone);
    if (!since) return [];
    const presentSet = new Set(attendanceByServant[servantId] ?? []);
    return bundle.serviceWeekdayDates.filter((d) => d >= since).map((d) => ({ date: d, present: presentSet.has(d) }));
  }

  function handleSort(key: typeof sortKey) {
    if (key === sortKey) {
      setSortDir((d) => (d === "asc" ? "desc" : "asc"));
    } else {
      setSortKey(key);
      setSortDir("asc");
    }
  }

  const dateOptions = useMemo(() => {
    const options = bundle.trackedDates.map((d) => ({
      value: d,
      label: d === bundle.todayDate ? `${formatDate(d)} (Today)` : formatDate(d),
    }));
    if (bundle.todayAvailable && !bundle.trackedDates.includes(bundle.todayDate)) {
      options.unshift({ value: bundle.todayDate, label: `${formatDate(bundle.todayDate)} (Today)` });
    }
    return options;
  }, [bundle.trackedDates, bundle.todayDate, bundle.todayAvailable]);

  const [date, setDate] = useState(dateOptions[0]?.value ?? bundle.todayDate);

  function statusLabel(servantId: string): "Present" | "Absent" | "Never Attended" {
    const dates = attendanceByServant[servantId] ?? [];
    if (dates.includes(date)) return "Present";
    return dates.length > 0 ? "Absent" : "Never Attended";
  }

  function handleToggle(servantId: string, fullName: string) {
    const isPresent = (attendanceByServant[servantId] ?? []).includes(date);
    const nextPresent = !isPresent;
    if (!confirm(`Mark ${fullName} as ${nextPresent ? "present" : "absent"} for ${date}?`)) return;
    setTogglingId(servantId);
    startTransition(async () => {
      const result = await setServantAttendanceAction(servantId, date, nextPresent);
      setTogglingId(null);
      if (result.error) {
        alert(result.error);
        return;
      }
      setAttendanceByServant((prev) => {
        const dates = prev[servantId] ?? [];
        return { ...prev, [servantId]: nextPresent ? [...dates, date] : dates.filter((d) => d !== date) };
      });
    });
  }

  const statusRank: Record<ReturnType<typeof statusLabel>, number> = { Present: 0, Absent: 1, "Never Attended": 2 };

  const visible = useMemo(() => {
    const q = search.trim().toLowerCase();
    const filtered = q ? bundle.members.filter((m) => m.full_name.toLowerCase().includes(q)) : bundle.members;
    const dir = sortDir === "asc" ? 1 : -1;
    return [...filtered].sort((a, b) => {
      let cmp: number;
      switch (sortKey) {
        case "group":
          cmp = a.groupLabel.localeCompare(b.groupLabel);
          break;
        case "attendance":
          cmp = (a.averageAttendance ?? -1) - (b.averageAttendance ?? -1);
          break;
        case "status":
          cmp = statusRank[statusLabel(a.id)] - statusRank[statusLabel(b.id)];
          break;
        default:
          cmp = 0;
      }
      // Name is always the tiebreaker (and the sort key itself when sortKey === "name").
      return dir * (cmp || a.full_name.localeCompare(b.full_name));
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [bundle.members, search, sortKey, sortDir, date, attendanceByServant]);

  if (dateOptions.length === 0) {
    return (
      <div className="mt-4 rounded-xl bg-white shadow-[0_4px_20px_rgba(0,0,0,0.06)] p-6 text-center text-sm text-[#666]">
        No service dates are tracked yet for {L.servantsLower}, and today isn&rsquo;t open for attendance until the configured
        cutoff time.
      </div>
    );
  }

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center gap-3">
        <label className="text-sm font-semibold text-[#333]">Service Date</label>
        <select
          value={date}
          onChange={(e) => setDate(e.target.value)}
          className="rounded-md border border-[#ddd] px-3 py-2 text-sm focus:border-brand focus:outline-none"
        >
          {dateOptions.map((d) => (
            <option key={d.value} value={d.value}>
              {d.label}
            </option>
          ))}
        </select>
        <input
          type="text"
          placeholder={`Search ${L.servantsLower}...`}
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          className="flex-1 min-w-[160px] rounded-md border border-[#ddd] px-3 py-2 text-sm focus:border-brand focus:outline-none"
        />
      </div>

      <p className="text-xs text-[#666]">
        {windowWeeks === null
          ? `Attendance % is calculated over each ${L.servantLower}'s entire history since their Join Date, counting only ${dayName}s.`
          : `Attendance % is a rolling trailing ${windowWeeks} week${windowWeeks === 1 ? "" : "s"}, counting only ${dayName}s, never counting weeks before someone joined.`}
      </p>

      <div className="rounded-xl bg-white shadow-[0_4px_20px_rgba(0,0,0,0.06)] overflow-hidden overflow-x-auto">
        <table className="w-full text-sm">
          <thead>
            <tr className="bg-[#f5f5f5] text-left text-[#666]">
              <SortableHeader label={L.servant} sortKey="name" activeKey={sortKey} dir={sortDir} onSort={handleSort} />
              <SortableHeader label="Group" sortKey="group" activeKey={sortKey} dir={sortDir} onSort={handleSort} />
              <SortableHeader label="Attendance %" sortKey="attendance" activeKey={sortKey} dir={sortDir} onSort={handleSort} />
              <SortableHeader
                label="Status"
                sortKey="status"
                activeKey={sortKey}
                dir={sortDir}
                onSort={handleSort}
                align="right"
              />
            </tr>
          </thead>
          <tbody className="divide-y divide-[#f0f0f0]">
            {visible.map((m) => {
              const status = statusLabel(m.id);
              return (
                <tr key={m.id}>
                  <td className="px-4 py-2.5 font-medium text-[#333]">{m.full_name}</td>
                  <td className="px-4 py-2.5 text-[#666]">{m.groupLabel}</td>
                  <td className="px-4 py-2.5 text-[#666]">
                    {m.averageAttendance === null ? (
                      "N/A"
                    ) : (
                      <button
                        type="button"
                        onClick={() => setHistoryMember({ id: m.id, full_name: m.full_name })}
                        className="text-brand font-semibold hover:underline"
                      >
                        {m.averageAttendance}%
                      </button>
                    )}
                  </td>
                  <td className="px-4 py-2.5 text-right">
                    <button
                      type="button"
                      disabled={togglingId === m.id}
                      onClick={() => handleToggle(m.id, m.full_name)}
                      className={`rounded-full px-3 py-1 text-xs font-semibold disabled:opacity-50 ${
                        status === "Present"
                          ? "bg-[#d4edda] text-[#155724] hover:bg-[#c3e6cb]"
                          : status === "Absent"
                            ? "bg-[#f8d7da] text-[#721c24] hover:bg-[#f5c6cb]"
                            : "bg-[#fff3cd] text-[#856404] hover:bg-[#ffeeba]"
                      }`}
                    >
                      {status}
                    </button>
                  </td>
                </tr>
              );
            })}
            {visible.length === 0 && (
              <tr>
                <td colSpan={4} className="px-4 py-6 text-center text-[#666]">
                  No {L.servantsLower} to show.
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>

      {historyMember && (
        <AttendanceHistoryModal
          fullName={historyMember.full_name}
          dates={historyFor(historyMember.id, bundle.members.find((m) => m.id === historyMember.id)?.join_date ?? null)}
          onClose={() => setHistoryMember(null)}
        />
      )}
    </div>
  );
}

function SortableHeader<K extends string>({
  label,
  sortKey,
  activeKey,
  dir,
  onSort,
  align,
}: {
  label: string;
  sortKey: K;
  activeKey: K;
  dir: "asc" | "desc";
  onSort: (key: K) => void;
  align?: "right";
}) {
  const active = activeKey === sortKey;
  return (
    <th className={`px-4 py-2 font-semibold ${align === "right" ? "text-right" : "text-left"}`}>
      <button
        type="button"
        onClick={() => onSort(sortKey)}
        className={`inline-flex items-center gap-1 hover:text-brand ${active ? "text-brand" : ""}`}
      >
        {label}
        <span className="text-[10px]">{active ? (dir === "asc" ? "▲" : "▼") : "⇅"}</span>
      </button>
    </th>
  );
}
