"use client";

import { useMemo, useState } from "react";
import type { MemberListItem } from "@/lib/members";
import type { University } from "@/lib/universities";
import type { ServantOption } from "@/lib/servants";
import type { GroupSummary } from "@/lib/groups";
import { useMyAssigned } from "@/components/MyAssignedContext";
import { SearchIcon } from "@/components/icons";
import { MemberGrid } from "./MemberGrid";
import { MemberOverridesContext, type MemberPatch } from "./MemberOverrides";
import { ALL_COHORTS_GROUP_ID } from "@/lib/allCohorts";

const PROXIMITIES = ["Local", "Regional", "Abroad", "Unknown"];

export function MemberListInteractive({
  members: serverMembers,
  groupId,
  groups,
  universities,
  universityLabel,
  programLabel,
  proximityEnabled,
  servants,
  memberLabel,
  groupLabel,
  canDelete,
  canEditAll,
  editableGroupIds,
  currentUserId,
  currentUserName,
  windowWeeks,
  serviceWeekdayDates,
  dayName,
}: {
  members: MemberListItem[];
  groupId: string;
  groups: GroupSummary[];
  universities: University[];
  universityLabel: string;
  programLabel: string;
  proximityEnabled: boolean;
  servants: ServantOption[];
  memberLabel: string;
  groupLabel: string;
  canDelete: boolean;
  /** Owner-reported (Read-Only bug follow-up): whether Edit/photo controls
   * show at all. `canEditAll` covers Admin/General Coordinator; otherwise a
   * member is only editable if its own group_id appears in
   * `editableGroupIds` -- someone can hold Read-Only at one cohort and a
   * real role at another, so this is resolved per-member, not as one flag. */
  canEditAll: boolean;
  editableGroupIds: string[];
  currentUserId: string;
  currentUserName: string;
  windowWeeks: number | null;
  serviceWeekdayDates: string[];
  dayName: string;
}) {
  const isCombined = groupId === ALL_COHORTS_GROUP_ID;
  const { myAssignedOnly, hydrated } = useMyAssigned();

  // Changes just saved from a youth's record, shown straight away (QA S-3,
  // R-2); dropped as soon as the server's refreshed list arrives, since that
  // already contains them.
  const [overrides, setOverrides] = useState<Record<string, MemberPatch>>({});
  const [seenServerMembers, setSeenServerMembers] = useState(serverMembers);
  if (serverMembers !== seenServerMembers) {
    setSeenServerMembers(serverMembers);
    setOverrides({});
  }
  const overridesApi = useMemo(
    () => ({
      apply: (memberId: string, patch: MemberPatch) =>
        setOverrides((prev) => ({ ...prev, [memberId]: { ...prev[memberId], ...patch } })),
    }),
    [],
  );
  const members = useMemo(
    () =>
      serverMembers
        .map((m) => (overrides[m.id] ? { ...m, ...overrides[m.id] } : m))
        // Deleted, or moved out of this group (the combined view keeps them).
        .filter((m) => !(m as MemberPatch).deleted && (isCombined || m.group_id === groupId)),
    [serverMembers, overrides, isCombined, groupId],
  );
  const [q, setQ] = useState("");
  const [showFilters, setShowFilters] = useState(false);
  const [cohortIds, setCohortIds] = useState<string[]>([]);
  const [servantIds, setServantIds] = useState<string[]>([]);
  const [universityIds, setUniversityIds] = useState<string[]>([]);
  const [proximities, setProximities] = useState<string[]>([]);
  const [excludeVisitors, setExcludeVisitors] = useState(false);
  const [hasPhoto, setHasPhoto] = useState(false);
  const [male, setMale] = useState(false);
  const [female, setFemale] = useState(false);

  const activeFilterCount =
    servantIds.length +
    universityIds.length +
    proximities.length +
    (excludeVisitors ? 1 : 0) +
    (hasPhoto ? 1 : 0) +
    (male ? 1 : 0) +
    (female ? 1 : 0);

  const filtered = useMemo(() => {
    let result = members;

    if (hydrated && myAssignedOnly) {
      result = result.filter((m) => m.assigned_servant_id === currentUserId);
    }
    if (cohortIds.length) {
      result = result.filter((m) => cohortIds.includes(m.group_id));
    }
    if (q.trim()) {
      const needle = q.trim().toLowerCase();
      result = result.filter((m) => m.full_name.toLowerCase().includes(needle));
    }
    if (excludeVisitors) result = result.filter((m) => !m.is_visitor);
    if (hasPhoto) result = result.filter((m) => !!m.photo_path);
    if (male || female) {
      result = result.filter((m) => (male && m.gender === "Male") || (female && m.gender === "Female"));
    }
    if (universityIds.length) {
      result = result.filter((m) => m.university && universityIds.includes(m.university.id));
    }
    if (proximityEnabled && proximities.length) {
      result = result.filter((m) => proximities.includes(m.university?.proximity ?? "Unknown"));
    }
    if (servantIds.length) {
      result = result.filter((m) => {
        if (servantIds.includes("unassigned") && !m.assigned_servant_id) return true;
        return m.assigned_servant_id && servantIds.includes(m.assigned_servant_id);
      });
    }

    return result;
  }, [members, q, excludeVisitors, hasPhoto, male, female, universityIds, proximityEnabled, proximities, servantIds, cohortIds, myAssignedOnly, hydrated, currentUserId]);

  function multiSelectValues(e: React.ChangeEvent<HTMLSelectElement>): string[] {
    return Array.from(e.target.selectedOptions).map((o) => o.value);
  }

  const isFiltered = filtered.length !== members.length;

  return (
    <MemberOverridesContext.Provider value={overridesApi}>
    <div>
      <p className="mb-2 text-sm font-semibold text-[#333]">
        {isFiltered
          ? `${filtered.length} of ${members.length} ${memberLabel.toLowerCase()}s shown`
          : `${members.length} ${memberLabel.toLowerCase()}${members.length === 1 ? "" : "s"}`}
      </p>

      {isCombined && groups.length > 0 && (
        <div className="mb-2">
          <p className="text-xs font-semibold text-[#666] mb-1">Filter by {groupLabel}</p>
          <div className="flex flex-wrap gap-x-4 gap-y-1">
          {groups.map((g) => (
            <label key={g.id} className="flex items-center gap-1.5 text-sm text-[#333]">
              <input
                type="checkbox"
                checked={cohortIds.includes(g.id)}
                onChange={(e) =>
                  setCohortIds((prev) => (e.target.checked ? [...prev, g.id] : prev.filter((id) => id !== g.id)))
                }
              />
              {g.name}
            </label>
          ))}
          </div>
        </div>
      )}

      <div className="flex gap-2">
        <input
          type="text"
          value={q}
          onChange={(e) => setQ(e.target.value)}
          placeholder={`Search ${memberLabel.toLowerCase()}s…`}
          className="flex-1 rounded-md border border-[#ddd] px-3 py-2 text-sm focus:border-brand focus:outline-none focus:ring-2 focus:ring-brand/10"
        />
        <button
          type="button"
          onClick={() => setShowFilters((v) => !v)}
          className="flex items-center gap-2 rounded-md bg-brand px-4 py-2 text-sm font-semibold text-white hover:bg-brand-dark shadow-[0_2px_4px_rgba(0,0,0,0.15)] transition-all hover:-translate-y-0.5 hover:shadow-[0_4px_8px_rgba(0,0,0,0.2)] active:translate-y-0 active:shadow-[0_1px_2px_rgba(0,0,0,0.15)]"
        >
          <SearchIcon className="h-4 w-4" />
          Filters
          {activeFilterCount > 0 && (
            <span className="rounded-full bg-[#dc3545] text-white text-[11px] px-2 py-0.5">{activeFilterCount}</span>
          )}
        </button>
      </div>

      {showFilters && (
        <div className="mt-2 rounded-md border border-[#ddd] p-3 space-y-3 bg-white">
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <div>
              <p className="text-sm font-semibold mb-1">Assigned Servant</p>
              <select
                multiple
                size={5}
                value={servantIds}
                onChange={(e) => setServantIds(multiSelectValues(e))}
                className="w-full rounded-md border border-[#ddd] text-sm"
              >
                <option value="unassigned">Unassigned</option>
                {servants.map((s) => (
                  <option key={s.id} value={s.id}>
                    {s.full_name}
                  </option>
                ))}
              </select>
            </div>
            <div>
              <p className="text-sm font-semibold mb-1">{universityLabel}</p>
              <select
                multiple
                size={5}
                value={universityIds}
                onChange={(e) => setUniversityIds(multiSelectValues(e))}
                className="w-full rounded-md border border-[#ddd] text-sm"
              >
                {universities.map((u) => (
                  <option key={u.id} value={u.id}>
                    {u.name}
                  </option>
                ))}
              </select>
            </div>
          </div>

          {proximityEnabled && (
            <div>
              <p className="text-sm font-semibold mb-1">Proximity</p>
              <div className="flex flex-wrap gap-4">
                {PROXIMITIES.map((p) => (
                  <label key={p} className="flex items-center gap-1.5 text-sm">
                    <input
                      type="checkbox"
                      checked={proximities.includes(p)}
                      onChange={(e) =>
                        setProximities((prev) => (e.target.checked ? [...prev, p] : prev.filter((x) => x !== p)))
                      }
                    />
                    {p}
                  </label>
                ))}
              </div>
            </div>
          )}

          <div>
            <p className="text-sm font-semibold mb-1">Other</p>
            <div className="flex flex-wrap gap-4">
              <label className="flex items-center gap-1.5 text-sm">
                <input type="checkbox" checked={excludeVisitors} onChange={(e) => setExcludeVisitors(e.target.checked)} />
                Exclude Visitors
              </label>
              <label className="flex items-center gap-1.5 text-sm">
                <input type="checkbox" checked={hasPhoto} onChange={(e) => setHasPhoto(e.target.checked)} />
                Has Photo
              </label>
              <label className="flex items-center gap-1.5 text-sm">
                <input type="checkbox" checked={male} onChange={(e) => setMale(e.target.checked)} />
                Male
              </label>
              <label className="flex items-center gap-1.5 text-sm">
                <input type="checkbox" checked={female} onChange={(e) => setFemale(e.target.checked)} />
                Female
              </label>
            </div>
          </div>

          <div className="flex gap-2 pt-1">
            <button
              type="button"
              onClick={() => {
                setServantIds([]);
                setUniversityIds([]);
                setProximities([]);
                setExcludeVisitors(false);
                setHasPhoto(false);
                setMale(false);
                setFemale(false);
              }}
              className="rounded-md bg-[#f0f0f0] px-4 py-2 text-sm font-semibold text-[#333] hover:bg-[#e0e0e0] shadow-[0_2px_4px_rgba(0,0,0,0.1)] transition-all hover:-translate-y-0.5 hover:shadow-[0_4px_8px_rgba(0,0,0,0.15)] active:translate-y-0 active:shadow-[0_1px_2px_rgba(0,0,0,0.1)]"
            >
              Clear All
            </button>
            <button
              type="button"
              onClick={() => setShowFilters(false)}
              className="rounded-md bg-[#f0f0f0] px-4 py-2 text-sm font-semibold text-[#333] hover:bg-[#e0e0e0] shadow-[0_2px_4px_rgba(0,0,0,0.1)] transition-all hover:-translate-y-0.5 hover:shadow-[0_4px_8px_rgba(0,0,0,0.15)] active:translate-y-0 active:shadow-[0_1px_2px_rgba(0,0,0,0.1)]"
            >
              Close Filters
            </button>
          </div>
        </div>
      )}

      <p className="mt-3 text-xs text-[#666]">
        {windowWeeks === null
          ? `Attendance % is calculated over each ${memberLabel.toLowerCase()}'s entire history since their Join Date, counting only ${dayName}s.`
          : `Attendance % is a rolling trailing ${windowWeeks} week${windowWeeks === 1 ? "" : "s"}, counting only ${dayName}s, never counting weeks before someone joined.`}
      </p>

      <MemberGrid
        members={filtered}
        groupId={groupId}
        groups={groups}
        groupLabel={groupLabel}
        universities={universities}
        universityLabel={universityLabel}
        programLabel={programLabel}
        proximityEnabled={proximityEnabled}
        windowWeeks={windowWeeks}
        serviceWeekdayDates={serviceWeekdayDates}
        servants={servants}
        memberLabel={memberLabel}
        canDelete={canDelete}
        canEditAll={canEditAll}
        editableGroupIds={editableGroupIds}
        currentUserName={currentUserName}
      />
    </div>
    </MemberOverridesContext.Provider>
  );
}
