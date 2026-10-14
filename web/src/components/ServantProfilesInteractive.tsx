"use client";

import { useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import type { ServantDirectoryEntry } from "@/lib/servant-directory";
import { PhoneLink } from "@/components/PhoneLink";
import { servantPhotoUrl } from "@/lib/storage";
import { groupByGender, genderSubheading } from "@/lib/gender-grouping";
import { ServantDetailModal } from "@/components/ServantDetailModal";
import type { AgreementStatus } from "@/lib/agreement";
import { useRoleLabels } from "@/components/RoleLabelsProvider";
import { COORDINATOR_CHIP, ServantTotals } from "@/components/ServantTotals";

/** Migration 0086: who still needs to sign the confidentiality agreement
 * (Admins and General Coordinators only; null for everyone else). */
type Agreements = Record<string, AgreementStatus> | null;

function initials(name: string): string {
  return name
    .split(" ")
    .map((w) => w[0])
    .slice(0, 2)
    .join("");
}

/** REQUIREMENTS.md §6.13 -- lists all servants; click any servant to view
 * their profile. Two view modes: Categorical (grouped by serving group,
 * then General Coordinators, then Unassigned; female before male within
 * each group) and Alphabetical. Group/cohort assignment lives on the
 * separate Servant Assignments screen. */
export function ServantProfilesInteractive({
  servants,
  canManageServants,
  agreements,
  groupLabel,
}: {
  servants: ServantDirectoryEntry[];
  canManageServants: boolean;
  agreements: Agreements;
  /** The ministry's word for a group (Ministry Settings), e.g. "Class". */
  groupLabel: string;
}) {
  const L = useRoleLabels();
  // Owner-requested (9 Oct 2026): "Unassigned to a Class", in the
  // ministry's own word for a group.
  const unassignedLabel = `Unassigned to a ${groupLabel}`;
  const router = useRouter();
  const [viewMode, setViewMode] = useState<"categorical" | "alphabetical">("categorical");
  const [search, setSearch] = useState("");
  const [selected, setSelected] = useState<ServantDirectoryEntry | null>(null);

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    if (!q) return servants;
    return servants.filter((s) => s.full_name.toLowerCase().includes(q));
  }, [servants, search]);

  const categorical = useMemo(() => {
    const byLabel = new Map<string, ServantDirectoryEntry[]>();
    const positionByLabel = new Map<string, number>();
    const order: string[] = [];
    const groupIdByLabel = new Map<string, string>();
    function add(label: string, entry: ServantDirectoryEntry, ladderPosition?: number, groupId?: string) {
      if (groupId) groupIdByLabel.set(label, groupId);
      if (!byLabel.has(label)) {
        byLabel.set(label, []);
        order.push(label);
        if (ladderPosition !== undefined) positionByLabel.set(label, ladderPosition);
      }
      byLabel.get(label)!.push(entry);
    }
    const gcLabel = L.generalCoordinators;
    for (const s of filtered) {
      for (const g of s.servantGroups) add(g.name, s, g.display_order, g.id);
      if (s.isUnassignedServant) add(unassignedLabel, s);
      if (s.isGeneralCoordinator) add(gcLabel, s);
    }
    // The groups' list order (display_order, GROUP_LADDER_PLAN D4), not
    // alphabetical by name -- same fix as Servant Assignments' Categorical
    // view (owner-reported), so both screens agree on ordering.
    const groupLabels = order
      .filter((l) => l !== gcLabel && l !== unassignedLabel)
      .sort((a, b) => (positionByLabel.get(a) ?? 0) - (positionByLabel.get(b) ?? 0));
    // Unassigned, then General Coordinators -- the order the old fixed-word
    // sort().reverse() gave, kept whatever the role word is.
    const tail = [unassignedLabel, gcLabel].filter((l) => order.includes(l));

    return [...groupLabels, ...tail].map((label) => ({
      label,
      // Only real cohorts get the Female/Male subheadings below (owner
      // asked for "within each Cohort grouping", same scope as Servant
      // Assignments) -- General Coordinators/Unassigned stay a flat list.
      isCohort: label !== gcLabel && label !== unassignedLabel,
      isUnassigned: label === unassignedLabel,
      groupId: groupIdByLabel.get(label) ?? null,
      entries: byLabel.get(label)!.sort((a, b) => a.full_name.localeCompare(b.full_name)),
    }));
  }, [filtered, L.generalCoordinators, unassignedLabel]);

  const alphabetical = useMemo(() => [...filtered].sort((a, b) => a.full_name.localeCompare(b.full_name)), [filtered]);
  const signedCount = agreements ? servants.filter((s) => agreements[s.id]?.is_current).length : 0;
  // Owner-requested (14 Oct 2026): the same breakdown as Servant Assignments.
  const isServant = (s: ServantDirectoryEntry) => s.isUnassignedServant || s.servantGroups.some((g) => g.servant);
  const totals = {
    servants: servants.filter(isServant).length,
    coordinators: servants.filter((s) => !isServant(s) && s.servantGroups.some((g) => g.coordinator)).length,
    generalCoordinators: servants.filter((s) => !isServant(s) && !s.servantGroups.some((g) => g.coordinator) && s.isGeneralCoordinator).length,
  };

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center gap-3">
        <input
          type="text"
          placeholder={`Search ${L.servantsLower}...`}
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          className="flex-1 min-w-[180px] rounded-md border border-[#ddd] px-3 py-2 text-sm focus:border-brand focus:outline-none"
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

      <ServantTotals {...totals} />
      {agreements && (
        <p className="text-sm text-[#555]">
          Confidentiality agreement: <strong>{signedCount}</strong> of {servants.length} have signed.
        </p>
      )}

      {viewMode === "categorical"
        ? categorical.map((bucket) => (
            <div key={bucket.label} className="rounded-xl bg-white shadow-[0_4px_20px_rgba(0,0,0,0.06)] p-4">
              <h3 className="text-sm font-bold text-brand mb-3">{bucket.label}</h3>
              {bucket.isCohort || bucket.isUnassigned ? (
                <GenderGroupedRows
                  entries={bucket.entries}
                  groupId={bucket.groupId}
                  unassigned={bucket.isUnassigned}
                  onSelect={setSelected}
                  agreements={agreements}
                />
              ) : (
                <ServantRows entries={bucket.entries} onSelect={setSelected} agreements={agreements} />
              )}
            </div>
          ))
        : (
            <div className="rounded-xl bg-white shadow-[0_4px_20px_rgba(0,0,0,0.06)] p-4">
              <ServantRows entries={alphabetical} onSelect={setSelected} agreements={agreements} />
            </div>
          )}

      {filtered.length === 0 && <p className="text-sm text-[#666] text-center py-8">No {L.servantsLower} match.</p>}

      {selected && (
        <ServantDetailModal
          servant={selected}
          canManageServants={canManageServants}
          agreement={agreements ? (agreements[selected.id] ?? null) : undefined}
          onClose={() => setSelected(null)}
          onSaved={() => router.refresh()}
        />
      )}
    </div>
  );
}

/** "n Female Servants" / "n Male Servants" subheadings within one cohort --
 * same treatment as Servant Assignments' Categorical view (owner-reported,
 * both screens should agree). */
function GenderGroupedRows({
  entries,
  groupId,
  unassigned = false,
  onSelect,
  agreements,
}: {
  entries: ServantDirectoryEntry[];
  groupId: string | null;
  /** The "Unassigned to a group" section (owner-requested 14 Oct 2026). */
  unassigned?: boolean;
  onSelect: (s: ServantDirectoryEntry) => void;
  agreements: Agreements;
}) {
  const L = useRoleLabels();
  const { female, male, other } = groupByGender(entries, (e) => e.gender);
  // Owner-requested (14 Oct 2026): the count is of real Servant grants here
  // -- a Coordinator (HSY Steward) without one still shows, marked, but
  // isn't counted. (SAY Coordinators also hold a Servant grant, so SAY's
  // numbers don't change.)
  const servantsHere = (rows: ServantDirectoryEntry[]) =>
    rows.filter((e) => (unassigned ? e.isUnassignedServant : e.servantGroups.some((g) => g.id === groupId && g.servant))).length;
  return (
    <div className="space-y-3">
      {(
        [
          ["Female", female],
          ["Male", male],
          ["Other", other],
        ] as const
      ).map(
        ([kind, rows]) =>
          rows.length > 0 && (
            <div key={kind}>
              <h4 className="text-[11px] font-bold text-[#666] uppercase tracking-wide mb-1.5">{genderSubheading(kind, servantsHere(rows), L)}</h4>
              <ServantRows entries={rows} groupId={groupId} onSelect={onSelect} agreements={agreements} />
            </div>
          ),
      )}
    </div>
  );
}

function ServantRows({
  entries,
  groupId = null,
  onSelect,
  agreements,
}: {
  entries: ServantDirectoryEntry[];
  /** Within a group: the Coordinator chip is for that group's Coordinators. */
  groupId?: string | null;
  onSelect: (s: ServantDirectoryEntry) => void;
  agreements: Agreements;
}) {
  const L = useRoleLabels();
  return (
    <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
      {entries.map((s) => {
        const photoUrl = servantPhotoUrl(s.photo_path);
        return (
          <button
            key={s.id}
            type="button"
            onClick={() => onSelect(s)}
            className="flex items-center gap-3 border border-[#f0f0f0] rounded-lg p-3 text-left hover:border-brand transition-colors"
          >
            <div className="h-10 w-10 shrink-0 rounded-full bg-brand text-white text-sm font-bold flex items-center justify-center overflow-hidden">
              {photoUrl ? (
                // eslint-disable-next-line @next/next/no-img-element
                <img loading="lazy" src={photoUrl} alt={s.full_name} className="h-full w-full object-cover" />
              ) : (
                initials(s.full_name)
              )}
            </div>
            <div className="min-w-0 flex-1">
              <div className="flex min-w-0 items-center gap-1.5">
                <p className="min-w-0 truncate font-semibold text-[#333]">{s.full_name}</p>
                {/* Owner-requested (14 Oct 2026): "Steward" (HSY) / "Coordinator" (SAY). */}
                {s.servantGroups.some((g) => g.coordinator && (groupId === null || g.id === groupId)) && (
                  <span className={COORDINATOR_CHIP}>{L.coordinator}</span>
                )}
              </div>
              <PhoneLink phone={s.phone} className="text-xs" />
              {agreements && !agreements[s.id]?.is_current && (
                <p className="text-[11px] font-semibold text-[#b45309]">Agreement not signed</p>
              )}
            </div>
          </button>
        );
      })}
    </div>
  );
}
