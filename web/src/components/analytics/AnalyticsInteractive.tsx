"use client";

import { Fragment, useMemo, useState } from "react";
import type { AnalyticsRawData, MemberAnalyticsRow } from "@/lib/analytics";
import type { ServantOption } from "@/lib/servants";
import type { GroupSummary } from "@/lib/groups";
import { useMyAssigned } from "@/components/MyAssignedContext";
import { useCohortFilter } from "@/components/CohortFilter";
import { isOnServiceWeekday, resolveAttendanceSince, weekdayName } from "@/lib/attendance-window";
import { groupByGender, genderSubheading } from "@/lib/gender-grouping";
import { ClipboardCheckIcon, UsersIcon, ChartBarIcon, MapPinIcon } from "@/components/icons";
import { ProximityDonut } from "@/components/charts/ProximityDonut";
import { AttendanceTrendChart } from "@/components/charts/AttendanceTrendChart";

type SortKey = "name" | "gender" | "caseload" | "cohort";

function cohortText(s: ServantOption): string {
  return s.groups.map((g) => g.name).join(", ");
}

/** REQUIREMENTS.md §6.7 -- Data Completeness and Average Attendance by
 * Month respect "My Assigned List" (§6.2) like every other tab; Servant
 * Assignments deliberately doesn't (see lib/analytics.ts). Servant
 * Assignments always offers a Categorical/Alphabetical toggle -- matching
 * Servant Assignments/Servant Profiles' own (owner-requested, for
 * consistency across all three screens, and across both a single cohort's
 * own Analytics tab and the "Load Youth Data for all cohorts" combined
 * view, `combined` below -- Categorical just has one cohort to show on a
 * single-cohort page, same shape either way): Alphabetical is the
 * existing flat, freely-sortable table; Categorical groups by cohort
 * (ladder order, Unassigned last -- never populated on a single-cohort
 * page, since that page only ever lists servants of the one cohort it's
 * scoped to) then by gender within each, same "n Female Servants"/"n Male
 * Servants" subheadings as the other two screens, fixed name order (no
 * independent per-column sort -- the grouping IS the order, same as those
 * screens). `combined` only still gates the flat table's Cohort
 * column/sort -- redundant there on a single-cohort page, since every row
 * would repeat the one same cohort name. */
export function AnalyticsInteractive({
  raw,
  servants,
  unassignedCount,
  memberLabel,
  groupLabel,
  proximityEnabled,
  currentUserId,
  combined = false,
  groups = [],
  serviceWeekday,
  windowWeeks,
}: {
  raw: AnalyticsRawData;
  servants: ServantOption[];
  unassignedCount: number;
  memberLabel: string;
  groupLabel: string;
  proximityEnabled: boolean;
  currentUserId: string;
  combined?: boolean;
  /** The combined view's groups, for the header's cohort filter. Owner-
   * requested (30 Sep 2026): the combined view shows aggregates only --
   * no per-cohort curves or per-cohort servant tables; the cohort filter
   * narrows what is aggregated. */
  groups?: GroupSummary[];
  /** Owner-reported (§6.7/§6.4 alignment): Average Attendance by Month used
   * to count every tracked date with no rolling-window cap, while the
   * Member List's per-person average attendance % only counts the
   * configured service weekday and caps to a rolling window -- diverging
   * from it for no real reason. Now uses the exact same
   * isOnServiceWeekday()/resolveAttendanceSince() rules as
   * lib/members.ts's getGroupMembers(), just aggregated per month instead
   * of per person. */
  serviceWeekday: number;
  windowWeeks: number | null;
}) {
  const { myAssignedOnly, hydrated } = useMyAssigned();
  const applyFilter = hydrated && myAssignedOnly;
  // Combined view: the header's cohort checkboxes (CohortFilter).
  const groupIds = useMemo(() => (combined ? groups.map((g) => g.id) : []), [combined, groups]);
  const cohort = useCohortFilter(groupIds);
  // Every youth (visitors too) in the chosen cohorts -- the base for the
  // servants' caseloads and the unassigned count when filtered.
  const cohortMembers = useMemo(
    () => (cohort.isFiltered ? raw.members.filter((m) => cohort.matches(m.group_id)) : raw.members),
    [raw.members, cohort],
  );
  // Servants of the chosen cohorts, with caseloads counted in them only.
  const visibleServants = useMemo(() => {
    if (!cohort.isFiltered) return servants;
    return servants
      .filter((s) => s.groups.some((g) => cohort.matches(g.id)))
      .map((s) => ({
        ...s,
        groups: s.groups.filter((g) => cohort.matches(g.id)),
        caseload: cohortMembers.filter((m) => m.assigned_servant_id === s.id).length,
      }));
  }, [servants, cohort, cohortMembers]);
  const visibleUnassignedCount = cohort.isFiltered
    ? cohortMembers.filter((m) => !m.assigned_servant_id).length
    : unassignedCount;
  const [sortKey, setSortKey] = useState<SortKey>("name");
  const [sortDesc, setSortDesc] = useState(false);
  const [servantsView, setServantsView] = useState<"categorical" | "alphabetical">("categorical");

  const filteredMembers = useMemo(() => {
    const rows = applyFilter ? cohortMembers.filter((m) => m.assigned_servant_id === currentUserId) : cohortMembers;
    return rows.filter((m) => !m.is_visitor);
  }, [cohortMembers, applyFilter, currentUserId]);

  const completeness = useMemo(() => {
    const total = filteredMembers.length;
    const pct = (count: number) => (total > 0 ? Math.round((count / total) * 100) : 0);
    return {
      total,
      pctAssignedServant: pct(filteredMembers.filter((m) => m.assigned_servant_id).length),
      pctPhone: pct(filteredMembers.filter((m) => m.hasPhone).length),
      pctEmail: pct(filteredMembers.filter((m) => m.hasEmail).length),
      pctDob: pct(filteredMembers.filter((m) => m.hasDob).length),
      pctFatherOfConfession: pct(filteredMembers.filter((m) => m.hasFatherOfConfession).length),
      pctPhoto: pct(filteredMembers.filter((m) => m.hasPhoto).length),
    };
  }, [filteredMembers]);

  const genderSplit = useMemo(() => {
    const { female, male } = groupByGender(filteredMembers, (m) => m.gender);
    const total = female.length + male.length;
    const pct = (count: number) => (total > 0 ? Math.round((count / total) * 100) : 0);
    return { maleCount: male.length, malePct: pct(male.length), femaleCount: female.length, femalePct: pct(female.length) };
  }, [filteredMembers]);

  const proximity = useMemo(() => {
    const counts = { Local: 0, Regional: 0, Abroad: 0, Unknown: 0 };
    for (const m of filteredMembers) counts[m.proximity] += 1;
    return counts;
  }, [filteredMembers]);

  // Owner-reported: this used to count every tracked date with no rolling-
  // window cap, diverging from the Member List's per-person average
  // attendance % for no real reason -- aligned to the exact same rules now
  // (isOnServiceWeekday/resolveAttendanceSince, lib/attendance-window.ts),
  // just aggregated per month instead of per person.
  function computeMonthly(members: MemberAnalyticsRow[]) {
    const memberIds = new Set(members.map((m) => m.id));
    const relevantAttendance = raw.attendance.filter(
      (a) => memberIds.has(a.memberId) && isOnServiceWeekday(a.serviceDate, serviceWeekday),
    );

    const datesByMonth = new Map<string, Set<string>>();
    for (const a of relevantAttendance) {
      const month = a.serviceDate.slice(0, 7);
      if (!datesByMonth.has(month)) datesByMonth.set(month, new Set());
      datesByMonth.get(month)!.add(a.serviceDate);
    }
    const presentSet = new Set(relevantAttendance.map((a) => `${a.memberId}|${a.serviceDate}`));

    return Array.from(datesByMonth.keys())
      .sort()
      .reverse()
      .map((month) => {
        const dates = Array.from(datesByMonth.get(month)!);
        let presentCount = 0;
        let totalSlots = 0;
        for (const m of members) {
          const since = resolveAttendanceSince(m.join_date, windowWeeks);
          if (!since) continue;
          for (const d of dates) {
            if (d < since) continue;
            totalSlots += 1;
            if (presentSet.has(`${m.id}|${d}`)) presentCount += 1;
          }
        }
        const avgPercent = totalSlots > 0 ? Math.round((presentCount / totalSlots) * 100) : 0;
        const label = new Date(`${month}-01T00:00:00`).toLocaleDateString(undefined, {
          month: "long",
          year: "numeric",
        });
        return { month, label, avgPercent };
      });
  }

  const monthly = useMemo(
    () => computeMonthly(filteredMembers),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [filteredMembers, raw.attendance, serviceWeekday, windowWeeks],
  );

  const sortedServants = useMemo(() => {
    return [...visibleServants].sort((a, b) => {
      let cmp = 0;
      if (sortKey === "name") cmp = a.full_name.localeCompare(b.full_name);
      else if (sortKey === "gender") cmp = (a.gender ?? "").localeCompare(b.gender ?? "");
      else if (sortKey === "cohort") cmp = cohortText(a).localeCompare(cohortText(b));
      else cmp = a.caseload - b.caseload;
      return sortDesc ? -cmp : cmp;
    });
  }, [visibleServants, sortKey, sortDesc]);

  // Categorical view (owner-requested, matches Servant Assignments/Servant
  // Profiles): cohorts in ladder order, Unassigned last; a person holding
  // Servant grants at more than one cohort appears under each (same rule
  // those two screens already use).
  // Combined view (owner-requested 30 Sep 2026): aggregate only -- one
  // table of every servant of the chosen cohorts, each listed once with
  // their whole caseload, still split by gender.
  const categoricalCohorts = useMemo(() => {
    if (combined) {
      return {
        cohorts: [{ id: "all", name: "", display_order: 0, servants: visibleServants.filter((s) => s.groups.length > 0) }],
        unassigned: visibleServants.filter((s) => s.groups.length === 0),
      };
    }
    const byCohortId = new Map<string, { id: string; name: string; display_order: number; servants: ServantOption[] }>();
    const unassigned: ServantOption[] = [];
    for (const s of visibleServants) {
      if (s.groups.length === 0) {
        unassigned.push(s);
        continue;
      }
      for (const g of s.groups) {
        if (!byCohortId.has(g.id)) byCohortId.set(g.id, { id: g.id, name: g.name, display_order: g.display_order, servants: [] });
        byCohortId.get(g.id)!.servants.push(s);
      }
    }
    const cohorts = Array.from(byCohortId.values()).sort((a, b) => a.display_order - b.display_order);
    return { cohorts, unassigned };
  }, [combined, visibleServants]);

  function handleSort(key: SortKey) {
    if (key === sortKey) setSortDesc((v) => !v);
    else {
      setSortKey(key);
      setSortDesc(false);
    }
  }
  function indicator(key: SortKey) {
    return sortKey === key ? (sortDesc ? " ▼" : " ▲") : "";
  }

  return (
    <div className="mt-4 space-y-6">
      <section className="bg-white rounded-xl shadow-[0_4px_20px_rgba(0,0,0,0.06)] p-5">
        <h2 className="flex items-center gap-2 text-lg font-bold text-brand mb-4">
          <ClipboardCheckIcon className="h-5 w-5" /> Data Completeness
        </h2>
        <div className="grid grid-cols-2 sm:grid-cols-3 gap-4">
          <StatCard label="Assigned to Servants" value={`${completeness.pctAssignedServant}%`} />
          <StatCard label="Has Phone" value={`${completeness.pctPhone}%`} />
          <StatCard label="Has Email" value={`${completeness.pctEmail}%`} />
          <StatCard label="Has Date of Birth" value={`${completeness.pctDob}%`} />
          <StatCard label="Has Father of Confession" value={`${completeness.pctFatherOfConfession}%`} />
          <StatCard label="Has Photo" value={`${completeness.pctPhoto}%`} />
        </div>
        <p className="mt-3 text-xs text-[#666]">
          Based on {completeness.total} active {memberLabel.toLowerCase()}
          {completeness.total === 1 ? "" : "s"} (visitors excluded{applyFilter ? ", filtered to your assigned list" : ""}
          ).
        </p>
      </section>

      <section className="bg-white rounded-xl shadow-[0_4px_20px_rgba(0,0,0,0.06)] p-5">
        <h2 className="flex items-center gap-2 text-lg font-bold text-brand mb-4">
          <UsersIcon className="h-5 w-5" /> Gender Split
        </h2>
        <div className="grid grid-cols-2 sm:grid-cols-3 gap-4">
          <StatCard label="Male" value={`${genderSplit.maleCount} (${genderSplit.malePct}%)`} />
          <StatCard label="Female" value={`${genderSplit.femaleCount} (${genderSplit.femalePct}%)`} />
        </div>
        <p className="mt-3 text-xs text-[#666]">
          Based on {completeness.total} active {memberLabel.toLowerCase()}
          {completeness.total === 1 ? "" : "s"} (visitors excluded{applyFilter ? ", filtered to your assigned list" : ""}
          ).
        </p>
      </section>

      {proximityEnabled && (
        <section className="bg-white rounded-xl shadow-[0_4px_20px_rgba(0,0,0,0.06)] p-5">
          <h2 className="flex items-center gap-2 text-lg font-bold text-brand mb-4">
            <MapPinIcon className="h-5 w-5" /> Proximity
          </h2>
          <ProximityDonut
            local={proximity.Local}
            regional={proximity.Regional}
            abroad={proximity.Abroad}
            unknown={proximity.Unknown}
            centerLabel={`${memberLabel}s`}
          />
          <p className="mt-3 text-xs text-[#666]">
            {completeness.total} active {memberLabel.toLowerCase()}
            {completeness.total === 1 ? "" : "s"} (visitors excluded{applyFilter ? ", filtered to your assigned list" : ""}).
          </p>
        </section>
      )}

      <section className="bg-white rounded-xl shadow-[0_4px_20px_rgba(0,0,0,0.06)] p-5">
        <h2 className="flex items-center gap-2 text-lg font-bold text-brand mb-4">
          <ChartBarIcon className="h-5 w-5" /> Average Attendance by Month
        </h2>
        {monthly.length === 0 ? (
          <p className="text-sm text-[#666]">No tracked service dates yet.</p>
        ) : (
          <div className="overflow-x-auto">
            <AttendanceTrendChart data={[...monthly].reverse()} />
          </div>
        )}
        <p className="mt-3 text-xs text-[#666]">
          {windowWeeks === null
            ? `Calculated over each ${memberLabel.toLowerCase()}'s entire history since their Join Date, counting only ${weekdayName(serviceWeekday)}s -- same rule as the Member List's average attendance %.`
            : `A rolling trailing ${windowWeeks} week${windowWeeks === 1 ? "" : "s"}, counting only ${weekdayName(serviceWeekday)}s, never counting weeks before someone joined -- same rule as the Member List's average attendance %.`}
        </p>

      </section>

      <section className="bg-white rounded-xl shadow-[0_4px_20px_rgba(0,0,0,0.06)] p-5">
        <div className="flex flex-wrap items-center justify-between gap-3 mb-4">
          <h2 className="flex items-center gap-2 text-lg font-bold text-brand">
            <UsersIcon className="h-5 w-5" /> Servant Assignments
          </h2>
          <div className="flex rounded-md border border-[#ddd] overflow-hidden text-sm">
            <button
              type="button"
              onClick={() => setServantsView("categorical")}
              className={`px-3 py-1.5 font-semibold ${servantsView === "categorical" ? "bg-brand text-white" : "bg-white text-[#333]"}`}
            >
              Categorical
            </button>
            <button
              type="button"
              onClick={() => setServantsView("alphabetical")}
              className={`px-3 py-1.5 font-semibold ${servantsView === "alphabetical" ? "bg-brand text-white" : "bg-white text-[#333]"}`}
            >
              Alphabetical
            </button>
          </div>
        </div>

        {servantsView === "categorical" ? (
          <div className="space-y-4">
            {categoricalCohorts.cohorts.filter((c) => c.servants.length > 0).map((cohort) => (
              <ServantCohortTable key={cohort.id} label={cohort.name} servants={cohort.servants} memberLabel={memberLabel} />
            ))}
            {categoricalCohorts.unassigned.length > 0 && (
              <ServantCohortTable label="Unassigned" servants={categoricalCohorts.unassigned} memberLabel={memberLabel} />
            )}
            <div className="overflow-hidden rounded-lg border border-[#f0f0f0]">
              <table className="w-full text-sm">
                <tbody>
                  <tr className="bg-[#f9f9f9]">
                    <td className="px-4 py-2.5 font-semibold text-[#333]">Unassigned {memberLabel}s (no servant)</td>
                    <td className="px-4 py-2.5 text-right font-semibold text-[#333]">{visibleUnassignedCount}</td>
                  </tr>
                </tbody>
              </table>
            </div>
            {visibleServants.length === 0 && <p className="text-sm text-[#666] text-center py-6">No servants assigned yet.</p>}
          </div>
        ) : (
          <div className="overflow-hidden rounded-lg border border-[#f0f0f0]">
            <table className="w-full text-sm">
              <thead>
                <tr className="bg-[#f5f5f5] text-left text-[#666]">
                  <th className="px-4 py-2">
                    <button type="button" onClick={() => handleSort("name")} className="font-semibold hover:underline">
                      Servant{indicator("name")}
                    </button>
                  </th>
                  <th className="px-4 py-2">
                    <button type="button" onClick={() => handleSort("gender")} className="font-semibold hover:underline">
                      Gender{indicator("gender")}
                    </button>
                  </th>
                  {combined && (
                    <th className="px-4 py-2">
                      <button type="button" onClick={() => handleSort("cohort")} className="font-semibold hover:underline">
                        {groupLabel}{indicator("cohort")}
                      </button>
                    </th>
                  )}
                  <th className="px-4 py-2 text-right">
                    <button type="button" onClick={() => handleSort("caseload")} className="font-semibold hover:underline">
                      Assigned {memberLabel}s{indicator("caseload")}
                    </button>
                  </th>
                </tr>
              </thead>
              <tbody className="divide-y divide-[#f0f0f0]">
                {sortedServants.map((s) => (
                  <tr key={s.id}>
                    <td className="px-4 py-2.5 font-medium text-[#333]">{s.full_name}</td>
                    <td className="px-4 py-2.5 text-[#666]">{s.gender ?? "—"}</td>
                    {combined && <td className="px-4 py-2.5 text-[#666]">{cohortText(s) || "—"}</td>}
                    <td className="px-4 py-2.5 text-right text-[#333]">{s.caseload}</td>
                  </tr>
                ))}
                <tr className="bg-[#f9f9f9]">
                  <td className="px-4 py-2.5 font-semibold text-[#333]" colSpan={combined ? 3 : 2}>
                    Unassigned
                  </td>
                  <td className="px-4 py-2.5 text-right font-semibold text-[#333]">{visibleUnassignedCount}</td>
                </tr>
                {sortedServants.length === 0 && (
                  <tr>
                    <td colSpan={combined ? 4 : 3} className="px-4 py-6 text-center text-[#666]">
                      No servants assigned to this group yet.
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
        )}
      </section>
    </div>
  );
}

/** One cohort's servants, categorical view: female-then-male subheadings
 * (same "n Female Servants"/"n Male Servants" pattern as Servant
 * Assignments/Servant Profiles), name-sorted within each -- no per-column
 * sort here, the grouping IS the order. Gender/Cohort columns are dropped
 * (redundant with the heading/subheading text). */
function ServantCohortTable({ label, servants, memberLabel }: { label: string; servants: ServantOption[]; memberLabel: string }) {
  const { female, male, other } = groupByGender(servants, (s) => s.gender);
  return (
    <div>
      {label && <h3 className="text-sm font-bold text-brand mb-2">{label}</h3>}
      <div className="overflow-hidden rounded-lg border border-[#f0f0f0]">
        <table className="w-full text-sm">
          <thead>
            <tr className="bg-[#f5f5f5] text-left text-[#666]">
              <th className="px-4 py-2 font-semibold">Servant</th>
              <th className="px-4 py-2 text-right font-semibold">Assigned {memberLabel}s</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-[#f0f0f0]">
            {(
              [
                ["Female", female],
                ["Male", male],
                ["Other", other],
              ] as const
            ).map(([kind, rows]) =>
              rows.length === 0 ? null : (
                <Fragment key={kind}>
                  <tr className="bg-[#f9f9f9]">
                    <td colSpan={2} className="px-4 py-1.5 text-[11px] font-bold uppercase tracking-wide text-[#666]">
                      {genderSubheading(kind, rows.length)}
                    </td>
                  </tr>
                  {[...rows]
                    .sort((a, b) => a.full_name.localeCompare(b.full_name))
                    .map((s) => (
                      <tr key={s.id}>
                        <td className="px-4 py-2.5 font-medium text-[#333]">{s.full_name}</td>
                        <td className="px-4 py-2.5 text-right text-[#333]">{s.caseload}</td>
                      </tr>
                    ))}
                </Fragment>
              ),
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}

function StatCard({ label, value }: { label: string; value: string }) {
  return (
    <div className="bg-white rounded-xl shadow-[0_4px_20px_rgba(0,0,0,0.06)] border-t-4 border-brand p-4">
      <h3 className="text-[11px] uppercase tracking-wide text-[#666] font-semibold">{label}</h3>
      <p className="mt-1 text-3xl font-bold text-brand">{value}</p>
    </div>
  );
}
