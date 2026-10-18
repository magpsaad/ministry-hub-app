"use client";

import { useCallback, useMemo, useState, useTransition } from "react";
import type { ServantAttendanceBundle, ServantAttendanceMember } from "@/lib/servant-attendance";
import { groupByGender, genderSubheading } from "@/lib/gender-grouping";
import { AVG_MODES, averageFor, formatSheetDate } from "@/lib/attendance-average";
import { setServantAttendanceAction } from "@/app/servants-attendance/actions";
import { AttendanceHistoryModal } from "@/components/attendance/AttendanceHistoryModal";
import { AverageControls, useAvgChoice } from "@/components/attendance/AverageControls";
import { useRoleLabels } from "@/components/RoleLabelsProvider";
import { UndoBar, type UndoInfo } from "@/components/attendance/UndoBar";
import { ServantWeeklyStrip } from "@/components/attendance/ServantWeeklyStrip";
import { COORDINATOR_CHIP } from "@/components/ServantTotals";
import { InfoTip } from "@/components/InfoTip";

/** REQUIREMENTS.md §6.13 -- same Present/Absent/"Never Attended" pattern as
 * the member Attendance tab (§6.5), applied to servants across the whole
 * ministry (not scoped to one group).
 *
 * Owner-requested (18 Oct 2026): two views, like Servant Assignments and
 * Servant Profiles -- Categorical (the default: a card per group in list
 * order, Female/Male within each, then "Unassigned to a Group", then the
 * General Coordinators) and Alphabetical (the sortable list, as before).
 * Someone serving in two groups is listed in both; marking them in one
 * marks them everywhere (it's one attendance per person). */
export function ServantsAttendanceInteractive({
  bundle,
  dayName,
  groupLabel,
  showGroups = false,
}: {
  bundle: ServantAttendanceBundle;
  dayName: string;
  groupLabel: string;
  /** The weekly strip's per-group lines: General Coordinators and Admins. */
  showGroups?: boolean;
}) {
  const L = useRoleLabels();
  const [attendanceByServant, setAttendanceByServant] = useState(bundle.attendanceByServant);
  const [eventsByServant, setEventsByServant] = useState(bundle.eventsByServant);
  // Owner-approved (10 Oct 2026, migration 0111): Service / Events / Both
  // over a period, remembered on this device.
  const [avgChoice, setAvgChoice] = useAvgChoice("servants", bundle.todayDate);
  const [togglingId, setTogglingId] = useState<string | null>(null);
  // Owner-approved (11 Oct 2026): Present without asking, Absent still
  // asks; either way a 4-second Undo bar.
  const [undo, setUndo] = useState<UndoInfo | null>(null);
  const closeUndo = useCallback(() => setUndo(null), []);
  const [search, setSearch] = useState("");
  const [viewMode, setViewMode] = useState<"categorical" | "alphabetical">("categorical");
  const [, startTransition] = useTransition();
  const [sortKey, setSortKey] = useState<"name" | "group" | "attendance" | "status">("name");
  const [sortDir, setSortDir] = useState<"asc" | "desc">("asc");
  const [historyMember, setHistoryMember] = useState<{ id: string; full_name: string } | null>(null);

  // An event counts once it's over or someone was there (incl. marked here).
  const events = useMemo(() => {
    const attended = new Set(Object.values(eventsByServant).flat());
    return bundle.events.map((e) => (e.held || attended.has(e.id) ? { ...e, held: true } : e));
  }, [bundle.events, eventsByServant]);

  // Their events: the classes they serve, plus whole-ministry ones.
  function averageOf(m: { id: string; join_date: string | null; groupIds: string[] }) {
    return averageFor({
      choice: avgChoice,
      today: bundle.todayDate,
      joinDate: m.join_date,
      usingAppSince: bundle.usingAppSince,
      groupIds: m.groupIds,
      serviceDates: bundle.serviceWeekdayDates,
      presentDates: new Set(attendanceByServant[m.id] ?? []),
      events,
      presentEvents: new Set(eventsByServant[m.id] ?? []),
    });
  }
  const percentById = new Map(bundle.members.map((m) => [m.id, averageOf(m).percent]));

  function handleSort(key: typeof sortKey) {
    if (key === sortKey) {
      setSortDir((d) => (d === "asc" ? "desc" : "asc"));
    } else {
      setSortKey(key);
      setSortDir("asc");
    }
  }

  // "Date" (owner-approved): service days show the date, events the date
  // and the event's name. Values: "d:<date>" or "e:<event id>".
  const dateOptions = useMemo(() => {
    const options = bundle.trackedDates.map((d) => ({
      value: `d:${d}`,
      date: d,
      label: d === bundle.todayDate ? `${formatSheetDate(d)} (Today)` : formatSheetDate(d),
    }));
    if (bundle.todayAvailable && !bundle.trackedDates.includes(bundle.todayDate)) {
      options.push({ value: `d:${bundle.todayDate}`, date: bundle.todayDate, label: `${formatSheetDate(bundle.todayDate)} (Today)` });
    }
    for (const e of bundle.events) options.push({ value: `e:${e.id}`, date: e.date, label: `${formatSheetDate(e.date)} – ${e.title}` });
    return options.sort((a, b) => (a.date === b.date ? a.value.localeCompare(b.value) : a.date < b.date ? 1 : -1));
  }, [bundle.trackedDates, bundle.todayDate, bundle.todayAvailable, bundle.events]);

  const [selected, setSelected] = useState(dateOptions[0]?.value ?? `d:${bundle.todayDate}`);
  const selectedEvent = selected.startsWith("e:") ? (bundle.events.find((e) => e.id === selected.slice(2)) ?? null) : null;
  const date = selectedEvent ? selectedEvent.date : selected.slice(2);
  const selectedLabel = dateOptions.find((o) => o.value === selected)?.label ?? date;

  function isPresent(servantId: string): boolean {
    return selectedEvent
      ? (eventsByServant[servantId] ?? []).includes(selectedEvent.id)
      : (attendanceByServant[servantId] ?? []).includes(date);
  }

  function statusLabel(servantId: string): "Present" | "Absent" | "Never Attended" {
    if (isPresent(servantId)) return "Present";
    const ever = (attendanceByServant[servantId] ?? []).length > 0 || (eventsByServant[servantId] ?? []).length > 0;
    return ever ? "Absent" : "Never Attended";
  }

  /** Saves one mark and shows it on the sheet; true when it worked. */
  async function saveMark(
    servantId: string,
    present: boolean,
    target: { event: typeof selectedEvent; date: string },
  ): Promise<boolean> {
    const result = await setServantAttendanceAction(servantId, target.date, present, target.event?.id ?? null);
    if (result.error) {
      alert(result.error);
      return false;
    }
    const key = target.event ? target.event.id : target.date;
    const update = (prev: Record<string, string[]>) => {
      const list = prev[servantId] ?? [];
      const without = list.filter((x) => x !== key);
      return { ...prev, [servantId]: present ? [...without, key] : without };
    };
    if (target.event) setEventsByServant(update);
    else setAttendanceByServant(update);
    return true;
  }

  function handleToggle(servantId: string, fullName: string) {
    const nextPresent = !isPresent(servantId);
    if (!nextPresent && !confirm(`Mark ${fullName} as absent for ${selectedLabel}?`)) return;
    const target = { event: selectedEvent, date };
    setTogglingId(servantId);
    startTransition(async () => {
      const ok = await saveMark(servantId, nextPresent, target);
      setTogglingId(null);
      if (!ok) return;
      setUndo({
        id: Date.now(),
        message: `${fullName} marked ${nextPresent ? "Present" : "Absent"}`,
        undo: () => saveMark(servantId, !nextPresent, target),
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
          cmp = (percentById.get(a.id) ?? -1) - (percentById.get(b.id) ?? -1);
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
  }, [bundle.members, search, sortKey, sortDir, selected, attendanceByServant, eventsByServant, avgChoice]);

  // Categorical view: each group's people (search applied), Female/Male.
  const unassignedLabel = `Unassigned to a ${groupLabel}`;
  const sections = useMemo(() => {
    const q = search.trim().toLowerCase();
    const shown = q ? bundle.members.filter((m) => m.full_name.toLowerCase().includes(q)) : bundle.members;
    const byName = (a: ServantAttendanceMember, b: ServantAttendanceMember) => a.full_name.localeCompare(b.full_name);
    const list: { key: string; label: string; groupId: string | null; byGender: boolean; members: ServantAttendanceMember[] }[] = [];
    for (const [groupId, name] of Object.entries(bundle.groupNames)) {
      const members = shown.filter((m) => m.groupIds.includes(groupId)).sort(byName);
      if (members.length > 0) list.push({ key: groupId, label: name, groupId, byGender: true, members });
    }
    const unassigned = shown.filter((m) => m.isUnassignedServant).sort(byName);
    if (unassigned.length > 0) list.push({ key: "unassigned", label: unassignedLabel, groupId: null, byGender: true, members: unassigned });
    const gcs = shown.filter((m) => m.isGeneralCoordinator).sort(byName);
    if (gcs.length > 0) list.push({ key: "gc", label: L.generalCoordinators, groupId: null, byGender: false, members: gcs });
    return list;
  }, [bundle.members, bundle.groupNames, search, unassignedLabel, L.generalCoordinators]);

  /** One person's line: name (with the Coordinator chip where they're one),
   * their average, the Present/Absent button, and -- Alphabetical only --
   * their group. */
  function personRow(m: ServantAttendanceMember, chip: boolean, withGroup: boolean) {
    const status = statusLabel(m.id);
    const percent = percentById.get(m.id) ?? null;
    return (
      <tr key={m.id}>
        <td className="px-4 py-2.5 font-medium text-[#333]">
          {/* Owner-requested (15 Oct 2026): Coordinators / Stewards marked. */}
          <span className="flex items-center gap-1.5">
            <span>{m.full_name}</span>
            {chip && <span className={COORDINATOR_CHIP}>{L.coordinator}</span>}
          </span>
        </td>
        <td className="px-4 py-2.5 text-[#666]">
          {percent === null ? (
            "N/A"
          ) : (
            <button
              type="button"
              onClick={() => setHistoryMember({ id: m.id, full_name: m.full_name })}
              className="text-brand font-semibold hover:underline"
            >
              {percent}%
            </button>
          )}
        </td>
        <td className="px-4 py-2.5">
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
        {withGroup && (
          // Owner-reported (10 Oct 2026): long HSY class names wrapped over
          // 3-4 lines; at least this wide, they take two at most. (The width
          // is on an inner block: browsers ignore min-width on a table cell.)
          <td className="px-4 py-2.5 text-[#666]">
            <div className="min-w-[11rem]">{m.groupLabel}</div>
          </td>
        )}
      </tr>
    );
  }

  const percentColumn = AVG_MODES.find((x) => x.value === avgChoice.mode)?.column ?? "Attendance %";

  if (dateOptions.length === 0) {
    return (
      <div className="mt-4 rounded-xl bg-white shadow-[0_4px_20px_rgba(0,0,0,0.06)] p-6 text-center text-sm text-[#666]">
        No dates are tracked yet for {L.servantsLower}, and today isn&rsquo;t open for attendance until the configured
        cutoff time.
      </div>
    );
  }

  return (
    <div className="space-y-4">
      <ServantWeeklyStrip
        members={bundle.members}
        attendanceByServant={attendanceByServant}
        serviceDates={bundle.serviceWeekdayDates}
        groupNames={bundle.groupNames}
        showGroups={showGroups}
      />

      <div className="flex flex-wrap items-center gap-3">
        <label htmlFor="servants-attendance-date" className="text-sm font-semibold text-[#333]">
          Date
        </label>
        <select
          id="servants-attendance-date"
          value={selected}
          onChange={(e) => setSelected(e.target.value)}
          className="min-w-0 max-w-full rounded-md border border-[#ddd] px-3 py-2 text-sm focus:border-brand focus:outline-none"
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
        <div className="flex rounded-md border border-[#ddd] overflow-hidden text-sm">
          <button
            type="button"
            onClick={() => setViewMode("categorical")}
            className={`px-3 py-2 font-semibold ${viewMode === "categorical" ? "bg-brand text-white" : "bg-white text-[#333]"}`}
          >
            Categorical
          </button>
          <button
            type="button"
            onClick={() => setViewMode("alphabetical")}
            className={`px-3 py-2 font-semibold ${viewMode === "alphabetical" ? "bg-brand text-white" : "bg-white text-[#333]"}`}
          >
            Alphabetical
          </button>
        </div>
      </div>

      <AverageControls
        choice={avgChoice}
        onChange={setAvgChoice}
        today={bundle.todayDate}
        info={
          <InfoTip title="How the average works" className="[&_svg]:h-4 [&_svg]:w-4">
            <p>
              Service counts {dayName}s only. Events count the ones for each {L.servantLower}&rsquo;s own{" "}
              {groupLabel.toLowerCase()}s and the whole ministry. Nothing counts from before someone joined.
            </p>
          </InfoTip>
        }
      />

      {viewMode === "categorical" ? (
        <div className="space-y-4">
          {sections.map((s) => {
            const servantsHere = (rows: ServantAttendanceMember[]) =>
              rows.filter((m) => (s.groupId ? m.servantGroupIds.includes(s.groupId) : m.isUnassignedServant)).length;
            const parts = s.byGender
              ? (() => {
                  const { female, male, other } = groupByGender(s.members, (m) => m.gender);
                  return (
                    [
                      ["Female", female],
                      ["Male", male],
                      ["Other", other],
                    ] as const
                  ).filter(([, rows]) => rows.length > 0);
                })()
              : null;
            const table = (rows: ServantAttendanceMember[]) => (
              <div className="overflow-x-auto">
                <table className="w-full text-sm">
                  <thead>
                    <tr className="bg-[#f5f5f5] text-left text-[#666]">
                      <th className="px-4 py-2 font-semibold">{L.servant}</th>
                      <th className="px-4 py-2 font-semibold">{percentColumn}</th>
                      <th className="px-4 py-2 font-semibold">Status</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-[#f0f0f0]">
                    {rows.map((m) => personRow(m, s.groupId !== null && m.coordinatorGroupIds.includes(s.groupId), false))}
                  </tbody>
                </table>
              </div>
            );
            return (
              <div key={s.key} className="rounded-xl bg-white shadow-[0_4px_20px_rgba(0,0,0,0.06)] p-4">
                <h3 className="text-sm font-bold text-brand mb-3">{s.label}</h3>
                {parts ? (
                  <div className="space-y-3">
                    {parts.map(([kind, rows]) => (
                      <div key={kind}>
                        <h4 className="text-[11px] font-bold text-[#666] uppercase tracking-wide mb-1.5">
                          {genderSubheading(kind, servantsHere(rows), L)}
                        </h4>
                        {table(rows)}
                      </div>
                    ))}
                  </div>
                ) : (
                  table(s.members)
                )}
              </div>
            );
          })}
          {sections.length === 0 && <p className="py-6 text-center text-sm text-[#666]">No {L.servantsLower} to show.</p>}
        </div>
      ) : (
      <div className="rounded-xl bg-white shadow-[0_4px_20px_rgba(0,0,0,0.06)] overflow-hidden overflow-x-auto">
        <table className="w-full text-sm">
          <thead>
            <tr className="bg-[#f5f5f5] text-left text-[#666]">
              <SortableHeader label={L.servant} sortKey="name" activeKey={sortKey} dir={sortDir} onSort={handleSort} />
              <SortableHeader
                label={percentColumn}
                sortKey="attendance" activeKey={sortKey} dir={sortDir} onSort={handleSort} />
              <SortableHeader label="Status" sortKey="status" activeKey={sortKey} dir={sortDir} onSort={handleSort} />
              {/* Owner-requested (10 Oct 2026): Group last. */}
              <SortableHeader label="Group" sortKey="group" activeKey={sortKey} dir={sortDir} onSort={handleSort} />
            </tr>
          </thead>
          <tbody className="divide-y divide-[#f0f0f0]">
            {visible.map((m) => personRow(m, m.isCoordinator, true))}
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
      )}

      <UndoBar info={undo} onClose={closeUndo} />
      {historyMember && (
        <AttendanceHistoryModal
          fullName={historyMember.full_name}
          dates={(() => {
            const m = bundle.members.find((x) => x.id === historyMember.id);
            return m ? averageOf(m).rows : [];
          })()}
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
