"use client";

import { useMemo, useSyncExternalStore } from "react";
import { setSessionString, useSessionString } from "@/components/useSessionFlag";
import type { CohortFilterOption } from "@/lib/group-names";

const STORAGE_KEY = "combinedCohortFilter";

// Owner-requested (10 Oct 2026): while an event is picked on the
// Attendance tab, the groups it isn't for are greyed out here. The tab
// sets the groups the event IS for (null = no limit) and clears it when it
// closes.
let enabledGroups: string[] | null = null;
const enabledListeners = new Set<() => void>();
export function setCohortFilterEnabledGroups(groupIds: string[] | null) {
  enabledGroups = groupIds;
  enabledListeners.forEach((l) => l());
}
function useEnabledGroups(): string[] | null {
  return useSyncExternalStore(
    (listener) => {
      enabledListeners.add(listener);
      return () => {
        enabledListeners.delete(listener);
      };
    },
    () => enabledGroups,
    () => null,
  );
}

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

/** A checkbox standing for several groups (a whole grade) is ticked when all
 * of them are chosen; ticking it chooses them all, unticking clears them all. */
export function isOptionChecked(selected: string[], option: CohortFilterOption): boolean {
  return option.groupIds.every((id) => selected.includes(id));
}

export function toggleOption(selected: string[], option: CohortFilterOption): string[] {
  return isOptionChecked(selected, option)
    ? selected.filter((id) => !option.groupIds.includes(id))
    : [...selected, ...option.groupIds.filter((id) => !selected.includes(id))];
}

/** The cohort checkboxes, shown once in the combined view's header row so
 * they're the same on every tab. One per level for an Admin/General
 * Coordinator, one per group for a Coordinator (cohortFilterOptions). */
export function CohortFilterBar({ options, groupLabel }: { options: CohortFilterOption[]; groupLabel: string }) {
  const groupIds = useMemo(() => options.flatMap((o) => o.groupIds), [options]);
  const { selected } = useCohortFilter(groupIds);
  const enabled = useEnabledGroups();
  if (options.length < 2) return null;
  const word = options.some((o) => o.groupIds.length > 1) ? "level" : groupLabel.toLowerCase();
  return (
    <div className="flex flex-wrap items-center gap-x-4 gap-y-1">
      <span className="text-xs font-semibold text-[#666]">Show {word}s:</span>
      {options.map((o) => {
        const off = enabled !== null && !o.groupIds.some((id) => enabled.includes(id));
        return (
          <label
            key={o.key}
            title={off ? "Not part of the event picked" : undefined}
            className={`flex items-center gap-1.5 text-sm ${off ? "cursor-not-allowed text-[#bbb]" : "text-[#333]"}`}
          >
            <input
              type="checkbox"
              checked={isOptionChecked(selected, o)}
              disabled={off}
              onChange={() => setSessionString(STORAGE_KEY, toggleOption(selected, o).join(","))}
              className="accent-brand disabled:opacity-40"
            />
            {o.label}
          </label>
        );
      })}
      <span className="text-[11px] text-[#999]">(none ticked = all combined)</span>
    </div>
  );
}
