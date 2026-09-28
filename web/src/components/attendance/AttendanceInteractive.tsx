"use client";

import { useMemo, useState, useTransition } from "react";
import type { AttendanceBundle } from "@/lib/attendance";
import type { University } from "@/lib/universities";
import type { ServantOption } from "@/lib/servants";
import type { GroupSummary } from "@/lib/groups";
import { resolveAttendanceSince } from "@/lib/attendance-window";
import { useMyAssigned } from "@/components/MyAssignedContext";
import { MemberDetailLink } from "@/components/members/MemberDetailLink";
import { setAttendanceAction } from "@/app/g/[groupId]/attendance/actions";
import { AttendanceHistoryModal } from "./AttendanceHistoryModal";

/** What the Member Detail modal needs, so the attendance-history popup's
 * name can link back to the youth's record (owner-requested) -- the same
 * inputs the Member List hands its cards, with edit rights resolved per
 * cohort (`canEditAll` for Admin/General Coordinator, else only cohorts
 * listed in `editableGroupIds`; someone can be Read-Only at one cohort and
 * have a real role at another). */
export type AttendanceMemberRecordContext = {
  groups: GroupSummary[];
  groupLabel: string;
  universities: University[];
  universityLabel: string;
  programLabel: string;
  servants: ServantOption[];
  canDelete: boolean;
  canEditAll: boolean;
  editableGroupIds: string[];
  currentUserName: string;
};

const PROXIMITY_BADGE: Record<string, string> = {
  Local: "bg-[#d1ecf1] text-[#0c5460]",
  Regional: "bg-[#fff3cd] text-[#856404]",
  Abroad: "bg-[#f8d7da] text-[#721c24]",
  Unknown: "bg-[#e2e3e5] text-[#383d41]",
};

const STATUS_RANK: Record<"Present" | "Absent" | "Never Attended", number> = {
  Present: 0,
  Absent: 1,
  "Never Attended": 2,
};

function formatDate(iso: string): string {
  const [y, m, d] = iso.split("-").map(Number);
  return new Date(y, m - 1, d).toLocaleDateString(undefined, { month: "short", day: "numeric", year: "numeric" });
}

type SortKey = "name" | "proximity" | "status";

/** REQUIREMENTS.md §6.5 -- date picker + Present/Absent/"Never Attended"
 * table. The whole bundle (roster + every attendance row) is fetched once
 * server-side; switching the selected date is a pure client-side
 * recomputation, no round trip. Only Present is a real per-date write (a
 * row exists or doesn't); "Never Attended" is an automatic badge that
 * fully replaces "Absent" for anyone with zero attendance history.
 * Respects "My Assigned List" (§6.2) like every other tab. */
export function AttendanceInteractive({
  groupId,
  bundle,
  memberLabel,
  showProximity,
  currentUserId,
  memberRecord,
}: {
  groupId: string;
  bundle: AttendanceBundle;
  memberLabel: string;
  showProximity: boolean;
  currentUserId: string;
  memberRecord: AttendanceMemberRecordContext;
}) {
  const { myAssignedOnly, hydrated } = useMyAssigned();
  const [attendanceByMember, setAttendanceByMember] = useState(bundle.attendanceByMember);
  const [togglingId, setTogglingId] = useState<string | null>(null);
  const [sortKey, setSortKey] = useState<SortKey>("name");
  const [sortDesc, setSortDesc] = useState(false);
  const [excludeVisitors, setExcludeVisitors] = useState(false);
  const [historyMember, setHistoryMember] = useState<{ id: string; full_name: string } | null>(null);
  const [, startTransition] = useTransition();

  function historyFor(memberId: string, joinDate: string | null) {
    const since = resolveAttendanceSince(joinDate, bundle.windowWeeks);
    if (!since) return [];
    const presentSet = new Set(attendanceByMember[memberId] ?? []);
    return bundle.serviceWeekdayDates.filter((d) => d >= since).map((d) => ({ date: d, present: presentSet.has(d) }));
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

  function statusLabel(memberId: string): "Present" | "Absent" | "Never Attended" {
    const dates = attendanceByMember[memberId] ?? [];
    if (dates.includes(date)) return "Present";
    return dates.length > 0 ? "Absent" : "Never Attended";
  }

  function handleSort(key: SortKey) {
    if (key === sortKey) setSortDesc((v) => !v);
    else {
      setSortKey(key);
      setSortDesc(false);
    }
  }

  function handleToggle(memberId: string, fullName: string) {
    const isPresent = (attendanceByMember[memberId] ?? []).includes(date);
    const nextPresent = !isPresent;
    if (!confirm(`Mark ${fullName} as ${nextPresent ? "present" : "absent"} for ${date}?`)) return;
    setTogglingId(memberId);
    startTransition(async () => {
      const result = await setAttendanceAction(memberId, groupId, date, nextPresent);
      setTogglingId(null);
      if (result.error) {
        alert(result.error);
        return;
      }
      setAttendanceByMember((prev) => {
        const dates = prev[memberId] ?? [];
        return {
          ...prev,
          [memberId]: nextPresent ? [...dates, date] : dates.filter((d) => d !== date),
        };
      });
    });
  }

  const visible = useMemo(() => {
    let filtered =
      hydrated && myAssignedOnly ? bundle.members.filter((m) => m.assigned_servant_id === currentUserId) : bundle.members;
    if (excludeVisitors) filtered = filtered.filter((m) => !m.is_visitor);
    const sorted = [...filtered].sort((a, b) => {
      let cmp = 0;
      if (sortKey === "name") cmp = a.full_name.localeCompare(b.full_name);
      else if (sortKey === "proximity") cmp = a.proximity.localeCompare(b.proximity);
      else cmp = STATUS_RANK[statusLabel(a.id)] - STATUS_RANK[statusLabel(b.id)];
      return sortDesc ? -cmp : cmp;
    });
    return sorted;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [bundle.members, hydrated, myAssignedOnly, excludeVisitors, currentUserId, sortKey, sortDesc, date, attendanceByMember]);

  function sortIndicator(key: SortKey) {
    return sortKey === key ? (sortDesc ? " ▼" : " ▲") : "";
  }

  if (dateOptions.length === 0) {
    return (
      <div className="mt-4 rounded-xl bg-white shadow-[0_4px_20px_rgba(0,0,0,0.06)] p-6 text-center text-sm text-[#666]">
        No service dates are tracked yet for this group, and today isn&rsquo;t open for attendance until the
        configured cutoff time (or until someone checks in via the QR code).
      </div>
    );
  }

  return (
    <div className="mt-4 space-y-4">
      <div className="flex items-center gap-2">
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
        <label className="ml-auto flex items-center gap-1.5 text-sm text-[#333]">
          <input type="checkbox" checked={excludeVisitors} onChange={(e) => setExcludeVisitors(e.target.checked)} />
          Exclude visitors
        </label>
      </div>

      <div className="rounded-xl bg-white shadow-[0_4px_20px_rgba(0,0,0,0.06)] overflow-hidden overflow-x-auto">
        <table className="w-full text-sm">
          <thead>
            <tr className="bg-[#f5f5f5] text-left text-[#666]">
              <th className="px-4 py-2">
                <button type="button" onClick={() => handleSort("name")} className="font-semibold hover:underline">
                  {memberLabel}
                  {sortIndicator("name")}
                </button>
              </th>
              {showProximity && (
                <th className="px-4 py-2">
                  <button type="button" onClick={() => handleSort("proximity")} className="font-semibold hover:underline">
                    Proximity
                    {sortIndicator("proximity")}
                  </button>
                </th>
              )}
              <th className="px-4 py-2">Attendance %</th>
              <th className="px-4 py-2 text-right">
                <button type="button" onClick={() => handleSort("status")} className="font-semibold hover:underline">
                  Status
                  {sortIndicator("status")}
                </button>
              </th>
            </tr>
          </thead>
          <tbody className="divide-y divide-[#f0f0f0]">
            {visible.map((m) => {
              const status = statusLabel(m.id);
              return (
                <tr key={m.id}>
                  <td className="px-4 py-2.5">
                    <span className="font-medium text-[#333]">{m.full_name}</span>
                    {m.is_visitor && (
                      <span className="ml-2 rounded-full bg-[#ffe5cc] text-[#b35900] text-[10px] font-semibold px-2 py-0.5 align-middle">
                        Visitor
                      </span>
                    )}
                  </td>
                  {showProximity && (
                    <td className="px-4 py-2.5">
                      <span className={`rounded-full px-2.5 py-0.5 text-[11px] font-semibold ${PROXIMITY_BADGE[m.proximity]}`}>
                        {m.proximity}
                      </span>
                    </td>
                  )}
                  <td className="px-4 py-2.5">
                    {m.avgAttendancePercent === null ? (
                      <span className="text-[#666]">N/A</span>
                    ) : (
                      <button
                        type="button"
                        onClick={() => setHistoryMember({ id: m.id, full_name: m.full_name })}
                        className="text-brand font-semibold hover:underline"
                      >
                        {m.avgAttendancePercent}%
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
                <td colSpan={showProximity ? 4 : 3} className="px-4 py-6 text-center text-[#666]">
                  No {memberLabel.toLowerCase()}s to show.
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>

      {historyMember && (
        <AttendanceHistoryModal
          fullName={historyMember.full_name}
          title={
            <MemberDetailLink
              memberId={historyMember.id}
              groupId={groupId}
              groups={memberRecord.groups}
              groupLabel={memberRecord.groupLabel}
              universities={memberRecord.universities}
              universityLabel={memberRecord.universityLabel}
              programLabel={memberRecord.programLabel}
              servants={memberRecord.servants}
              memberLabel={memberLabel}
              canDelete={memberRecord.canDelete}
              canEdit={
                memberRecord.canEditAll ||
                memberRecord.editableGroupIds.includes(
                  bundle.members.find((m) => m.id === historyMember.id)?.group_id ?? "",
                )
              }
              currentUserName={memberRecord.currentUserName}
              className="hover:underline text-left"
            >
              {historyMember.full_name}
            </MemberDetailLink>
          }
          dates={historyFor(historyMember.id, bundle.members.find((m) => m.id === historyMember.id)?.join_date ?? null)}
          onClose={() => setHistoryMember(null)}
        />
      )}
    </div>
  );
}
