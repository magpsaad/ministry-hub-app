"use client";

import { useMemo } from "react";
import { setSessionString, useSessionString } from "@/components/useSessionFlag";

const STORAGE_KEY = "combinedCohortFilter";

/**
 * Owner-requested: in the combined view, the cohorts chosen on one tab apply
 * to every tab -- kept for the browser tab session like "My Assigned List".
 * Nothing chosen (or every cohort chosen) = all of them combined. Ids that
 * aren't among `groupIds` (another ministry's, or a group that has since
 * graduated) are ignored.
 */
export function useCohortFilter(groupIds: string[]) {
  const raw = useSessionString(STORAGE_KEY);
  return useMemo(() => {
    const filter = cohortFilterState(raw, groupIds);
    return {
      ...filter,
      toggle: (groupId: string) => setSessionString(STORAGE_KEY, nextCohortSelection(filter.selected, groupId).join(",")),
    };
  }, [raw, groupIds]);
}

/** The filter rule on its own (stored text -> what shows). */
export function cohortFilterState(raw: string | null, groupIds: string[]) {
  const stored = raw ? raw.split(",").filter(Boolean) : [];
  const selected = stored.filter((id) => groupIds.includes(id));
  // All chosen means the same as none chosen: the aggregate.
  const effective = selected.length === groupIds.length ? [] : selected;
  return {
    selected,
    /** Whether a row in this group should show. */
    matches: (groupId: string) => effective.length === 0 || effective.includes(groupId),
    isFiltered: effective.length > 0,
  };
}

export function nextCohortSelection(selected: string[], groupId: string): string[] {
  return selected.includes(groupId) ? selected.filter((id) => id !== groupId) : [...selected, groupId];
}

/** The cohort checkboxes, shown once in the combined view's header row so
 * they're the same on every tab. */
export function CohortFilterBar({ groups, groupLabel }: { groups: { id: string; name: string }[]; groupLabel: string }) {
  const groupIds = useMemo(() => groups.map((g) => g.id), [groups]);
  const { selected, toggle } = useCohortFilter(groupIds);
  if (groups.length < 2) return null;
  return (
    <div className="flex flex-wrap items-center gap-x-4 gap-y-1">
      <span className="text-xs font-semibold text-[#666]">Show {groupLabel.toLowerCase()}s:</span>
      {groups.map((g) => (
        <label key={g.id} className="flex items-center gap-1.5 text-sm text-[#333]">
          <input type="checkbox" checked={selected.includes(g.id)} onChange={() => toggle(g.id)} className="accent-brand" />
          {g.name}
        </label>
      ))}
      <span className="text-[11px] text-[#999]">(none ticked = all combined)</span>
    </div>
  );
}
