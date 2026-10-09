"use client";

import { useMemo, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import type { AssignmentPerson, RoleGrant } from "@/lib/servant-assignments";
import type { GroupSummary } from "@/lib/groups";
import { servantPhotoUrl } from "@/lib/storage";
import { groupByGender, genderSubheading } from "@/lib/gender-grouping";
import {
  reassignRoleGroupAction,
  countAssignmentsInGroupAction,
  revokeRoleGrantAction,
  grantServantRoleAction,
  grantCoordinatorScopeAction,
  type AddableRole,
} from "@/app/servant-assignments/actions";
import {
  parseSectionKey,
  sectionLabel,
  sectionOfGroup,
  sectionsFor,
  type CoordinatorScopeMode,
  type ScopeRef,
} from "@/lib/coordinator-scopes";
import { useRoleLabels } from "@/components/RoleLabelsProvider";
import type { RoleLabels } from "@/lib/role-labels";

function roleChipLabels(L: RoleLabels): Record<RoleGrant["role"], string> {
  return {
    servant: L.servant,
    // Owner-requested: displayed as just "Coordinator" now (was
    // "Sub-Coordinator") -- the internal role/key name is unchanged.
    sub_coordinator: L.coordinator,
    read_only: "Read-only",
    // Owner-requested (9 Oct 2026): the full label, not the initials.
    general_coordinator: L.generalCoordinator,
  };
}

/** One name for a Coordinator's several classes in the Alphabetical view
 * (owner-requested, 9 Oct 2026): the words their names share, e.g. "Gr12
 * Girls St. Demiana" + "Gr12 Girls St. Phoebe" -> "Gr12 Girls"; if they
 * share none, the names joined with "+". */
function combinedClassName(names: string[]): string {
  const words = names.map((n) => n.trim().split(/\s+/));
  const shared: string[] = [];
  const longest = Math.min(...words.map((w) => w.length - 1));
  for (let i = 0; i < longest && words.every((w) => w[i] === words[0][i]); i++) shared.push(words[0][i]);
  while (shared.length > 0 && /^(st\.?|sts\.?|-|–)$/i.test(shared[shared.length - 1])) shared.pop();
  return shared.length > 0 ? shared.join(" ") : names.join(" + ");
}

// Long class names are cut off at the chip's edge -- no "...", so those
// few characters show more of the name (owner-requested, 9 Oct 2026).
const CLIP = "min-w-0 overflow-hidden whitespace-nowrap text-clip";

const ADDABLE_ROLES: AddableRole[] = ["servant", "sub_coordinator", "read_only"];

function chipColor(role: RoleGrant["role"]): { bg: string; text: string } {
  switch (role) {
    case "servant":
      return { bg: "#e3f2fd", text: "#1976d2" };
    case "sub_coordinator":
      return { bg: "#f3e5f5", text: "#8e44ad" };
    case "general_coordinator":
      return { bg: "var(--brand)", text: "#ffffff" };
    default:
      return { bg: "#f0f0f0", text: "#666666" };
  }
}

function initials(name: string): string {
  return name.split(" ").map((w) => w[0]).slice(0, 2).join("");
}

type Row = { person: AssignmentPerson; grants: RoleGrant[] };

/** True if this row's grants (already filtered to one cohort) include an
 * actual Servant or Sub-Coordinator grant there -- i.e. they're really
 * serving that cohort, not just holding Read-Only access to its data
 * (owner-reported: Read-Only shouldn't count toward "n Female/Male
 * Servants" below). */
function isServingRow(row: Row): boolean {
  return row.grants.some((g) => g.role === "servant" || g.role === "sub_coordinator");
}

/**
 * REQUIREMENTS.md §6.13 -- redesigned to correctly handle a person holding
 * several `user_roles` grants at once (Servant + Sub-Coordinator at the
 * same cohort, Read-Only at several others, General Coordinator with no
 * cohort at all -- all intentional, §4.2). Every action targets one
 * specific grant's `user_roles.id`, never "every row this user holds for
 * this role" (the bug that produced a duplicate-key error the moment
 * someone held two Servant grants). Servant grants get a reassign dropdown
 * (there should be at most one, per ministry policy, so "move it" makes
 * sense); Sub-Coordinator/Read-Only grants get a remove "x" instead (a
 * person can hold several, so removing one and adding another elsewhere is
 * the natural operation, not "move"). General Coordinator is shown
 * read-only here -- granting/revoking it stays Access-Maintenance-only,
 * same as any brand-new person's very first grant (this screen only ever
 * adds another grant to someone who already has one).
 *
 * Owner-requested (8 Oct 2026, migration 0098): Coordinators help too, with
 * Servant roles in the groups they coordinate only -- add someone as a
 * Servant there, and move Servants into, out of (to Unassigned) or between
 * those groups. Everything else stays with General Coordinators and Admins
 * (canManageAll); the database enforces the same rule.
 */
export function ServantAssignmentsInteractive({
  people,
  groups,
  canManageAll,
  myGroupIds,
  groupLabel,
  coordinatorScope = "group",
  ladderLabel = "",
  levelOffset = 0,
}: {
  people: AssignmentPerson[];
  groups: GroupSummary[];
  /** General Coordinators and Admins. */
  canManageAll: boolean;
  /** The groups this person coordinates (sub_coordinator grants). */
  myGroupIds: string[];
  /** The ministry's word for a group (Ministry Settings), e.g. "Class". */
  groupLabel: string;
  /** Migration 0106 (Ministry Settings): Coordinators are assigned to each
   * group, a grade, or a grade and gender. */
  coordinatorScope?: CoordinatorScopeMode;
  /** The level word and number offset, for "Gr9 Girls". */
  ladderLabel?: string;
  levelOffset?: number;
}) {
  const L = useRoleLabels();
  const ROLE_LABELS = roleChipLabels(L);
  const coordinatorOnly = !canManageAll && myGroupIds.length > 0;
  const canManageServants = canManageAll || coordinatorOnly;
  const isMine = (groupId: string | null) => canManageAll || (groupId !== null && myGroupIds.includes(groupId));
  const addableRoles: readonly AddableRole[] = canManageAll ? ADDABLE_ROLES : ["servant"];
  const router = useRouter();
  // Picks up the fresh list after a Refresh by adjusting state during
  // render when the prop changes (React's recommended pattern), rather than
  // in an effect, which drew the screen twice (react-hooks/set-state-in-effect).
  const [roster, setRoster] = useState(people);
  const [prevPeople, setPrevPeople] = useState(people);
  if (people !== prevPeople) {
    setPrevPeople(people);
    setRoster(people);
  }

  const [viewMode, setViewMode] = useState<"categorical" | "alphabetical">("categorical");
  const [search, setSearch] = useState("");
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);

  const [addingForPerson, setAddingForPerson] = useState<string | null>(null);
  const [addRole, setAddRole] = useState<AddableRole>(canManageAll ? "read_only" : "servant");
  const [addGroupId, setAddGroupId] = useState("");

  const [addingForGroup, setAddingForGroup] = useState<string | null>(null);
  const [bringUserId, setBringUserId] = useState("");
  const [bringRole, setBringRole] = useState<AddableRole>("servant");

  const sortedGroups = useMemo(() => [...groups].sort((a, b) => a.display_order - b.display_order), [groups]);
  // The groups this person may put a Servant in.
  const myGroups = useMemo(
    () => (canManageAll ? sortedGroups : sortedGroups.filter((g) => myGroupIds.includes(g.id))),
    [canManageAll, sortedGroups, myGroupIds],
  );
  // Grade-level Coordinators (0106): the grades (or grade + gender) to pick.
  const byGrade = coordinatorScope !== "group";
  const sections = useMemo(
    () => sectionsFor(sortedGroups, coordinatorScope, ladderLabel, levelOffset),
    [sortedGroups, coordinatorScope, ladderLabel, levelOffset],
  );
  const groupWord = groupLabel.toLowerCase();
  const scopeLabel = (s: ScopeRef) => sectionLabel(s.ladder_position, s.gender_label, sortedGroups, ladderLabel, levelOffset);

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    if (!q) return roster;
    return roster.filter((p) => p.full_name.toLowerCase().includes(q));
  }, [roster, search]);

  function patchGrant(personId: string, grantId: string, patch: Partial<RoleGrant> | null) {
    setRoster((prev) =>
      prev.map((p) => {
        if (p.id !== personId) return p;
        const grants = patch === null ? p.grants.filter((g) => g.id !== grantId) : p.grants.map((g) => (g.id === grantId ? { ...g, ...patch } : g));
        return { ...p, grants };
      }),
    );
  }

  function handleReassign(personId: string, grant: RoleGrant, newGroupId: string) {
    setError(null);
    startTransition(async () => {
      // Q6 -- the move clears this servant's assignments in the group they
      // leave (reassign_role_group, migration 0069), so say how many first.
      if (grant.group_id && grant.group_id !== newGroupId) {
        const n = await countAssignmentsInGroupAction(personId, grant.group_id);
        if (n > 0 && !confirm(`This will clear ${n} youth assignment(s) in ${grant.group_name}. Continue?`)) return;
      }
      const res = await reassignRoleGroupAction(grant.id, newGroupId || null);
      if (res.error) {
        setError(res.error);
        return;
      }
      const g = newGroupId ? sortedGroups.find((x) => x.id === newGroupId) : null;
      patchGrant(personId, grant.id, {
        group_id: g?.id ?? null,
        group_name: g?.name ?? null,
        ladder_position: g?.ladder_position ?? null,
        display_order: g?.display_order ?? null,
      });
      router.refresh();
    });
  }

  function handleRevoke(personId: string, grant: RoleGrant) {
    // Part of a grade-level grant (0106): removing it removes the whole grade.
    const scope = grant.scope ?? null;
    const question = scope
      ? `Remove ${ROLE_LABELS[grant.role]} of ${scopeLabel(scope)}? This takes them off all its ${groupWord}s.`
      : `Remove ${ROLE_LABELS[grant.role]}${grant.group_name ? ` — ${grant.group_name}` : ""}?`;
    if (!confirm(question)) return;
    setError(null);
    startTransition(async () => {
      const res = await revokeRoleGrantAction(grant.id);
      if (res.error) {
        setError(res.error);
        return;
      }
      if (scope) {
        setRoster((prev) =>
          prev.map((p) => (p.id === personId ? { ...p, grants: p.grants.filter((g) => g.scope?.id !== scope.id) } : p)),
        );
      } else {
        patchGrant(personId, grant.id, null);
      }
      router.refresh();
    });
  }

  /** Grade-level Coordinator (0106): one grant for a grade (or grade +
   * gender); the database adds each group there. */
  function grantGrade(userId: string, ladderPosition: number, gender: string | null, done: () => void) {
    setError(null);
    startTransition(async () => {
      const res = await grantCoordinatorScopeAction(userId, ladderPosition, gender);
      if (res.error) {
        setError(res.error);
        return;
      }
      done();
      router.refresh();
    });
  }

  /** The combined Coordinator chip's x: removes each of its classes. */
  function handleRevokeMany(personId: string, grants: RoleGrant[]) {
    const names = grants.map((g) => g.group_name ?? "").join(" and ");
    if (!confirm(`Remove ${ROLE_LABELS[grants[0].role]} — ${names}?`)) return;
    setError(null);
    startTransition(async () => {
      for (const grant of grants) {
        const res = await revokeRoleGrantAction(grant.id);
        if (res.error) {
          setError(res.error);
          break;
        }
        patchGrant(personId, grant.id, null);
      }
      router.refresh();
    });
  }

  function handleAddRole(person: AssignmentPerson) {
    if (byGrade && addRole === "sub_coordinator") {
      if (!addGroupId) {
        setError("Pick a grade for this role.");
        return;
      }
      const s = parseSectionKey(addGroupId);
      grantGrade(person.id, s.ladder_position, s.gender_label, () => {
        setAddingForPerson(null);
        setAddGroupId("");
      });
      return;
    }
    if ((addRole !== "servant" || !canManageAll) && !addGroupId) {
      setError("Pick a group for this role.");
      return;
    }
    setError(null);
    startTransition(async () => {
      const res = await grantServantRoleAction(person.id, addRole, addGroupId || null);
      if (res.error || !res.id) {
        setError(res.error ?? "Could not add that role.");
        return;
      }
      const g = addGroupId ? sortedGroups.find((x) => x.id === addGroupId) : null;
      setRoster((prev) =>
        prev.map((p) =>
          p.id === person.id
            ? {
                ...p,
                grants: [
                  ...p.grants,
                  { id: res.id!, role: addRole, group_id: g?.id ?? null, group_name: g?.name ?? null, ladder_position: g?.ladder_position ?? null, display_order: g?.display_order ?? null },
                ],
              }
            : p,
        ),
      );
      setAddingForPerson(null);
      setAddGroupId("");
      router.refresh();
    });
  }

  function handleBringSomeoneNew(groupId: string) {
    if (!bringUserId) {
      setError("Pick a person first.");
      return;
    }
    const group = sortedGroups.find((x) => x.id === groupId);
    const section = group ? sectionOfGroup(group, coordinatorScope) : null;
    if (section && bringRole === "sub_coordinator") {
      grantGrade(bringUserId, section.ladder_position, section.gender_label, () => {
        setAddingForGroup(null);
        setBringUserId("");
      });
      return;
    }
    setError(null);
    startTransition(async () => {
      const res = await grantServantRoleAction(bringUserId, bringRole, groupId);
      if (res.error || !res.id) {
        setError(res.error ?? "Could not add that grant.");
        return;
      }
      const g = sortedGroups.find((x) => x.id === groupId) ?? null;
      setRoster((prev) =>
        prev.map((p) =>
          p.id === bringUserId
            ? { ...p, grants: [...p.grants, { id: res.id!, role: bringRole, group_id: g?.id ?? null, group_name: g?.name ?? null, ladder_position: g?.ladder_position ?? null, display_order: g?.display_order ?? null }] }
            : p,
        ),
      );
      setAddingForGroup(null);
      setBringUserId("");
      router.refresh();
    });
  }

  const categoricalBuckets = useMemo(() => {
    function rowsFor(pred: (g: RoleGrant) => boolean): Row[] {
      return filtered
        .map((p) => ({ person: p, grants: p.grants.filter(pred) }))
        .filter((r) => r.grants.length > 0)
        .sort((a, b) => a.person.full_name.localeCompare(b.person.full_name));
    }
    const unassigned = rowsFor((g) => g.role === "servant" && g.group_id === null);
    const cohorts = sortedGroups.map((g) => ({
      key: g.id,
      label: g.name,
      groupId: g.id,
      rows: rowsFor((gr) => gr.group_id === g.id),
    }));
    const generalCoordinators = rowsFor((g) => g.role === "general_coordinator");
    return { unassigned, cohorts, generalCoordinators };
  }, [filtered, sortedGroups]);

  const alphabetical = useMemo(() => [...filtered].sort((a, b) => a.full_name.localeCompare(b.full_name)), [filtered]);

  function renderChip(person: AssignmentPerson, grant: RoleGrant, showGroupInLabel: boolean) {
    const { bg, text } = chipColor(grant.role);
    // Owner-requested (9 Oct 2026): no "·" between the role and the class.
    const label = showGroupInLabel && grant.group_name ? `${ROLE_LABELS[grant.role]} ${grant.group_name}` : ROLE_LABELS[grant.role];

    if (grant.role === "servant") {
      // A Coordinator can move a Servant who is Unassigned or in one of
      // their groups, and only to Unassigned or one of their groups.
      const movable = canManageAll || (coordinatorOnly && (grant.group_id === null || isMine(grant.group_id)));
      const choices = canManageAll || !movable ? sortedGroups : sortedGroups.filter((g) => isMine(g.id) || g.id === grant.group_id);
      const options = (
        <>
          <option value="">Unassigned</option>
          {choices.map((g) => (
            <option key={g.id} value={g.id}>
              {g.name}
            </option>
          ))}
        </>
      );
      // Categorical view (owner-requested, 9 Oct 2026): the person is
      // already listed under their class's heading, so the chip just says
      // "Servant" like the Coordinator chips; tapping it still opens the
      // list of classes to move them to.
      if (!showGroupInLabel) {
        return (
          <span key={grant.id} className="relative inline-flex items-center gap-0.5 rounded-md px-2 py-1 text-[11px] font-semibold" style={{ backgroundColor: bg, color: text }}>
            {label}
            {movable && (
              <>
                <span aria-hidden="true">▾</span>
                <select
                  value={grant.group_id ?? ""}
                  disabled={pending}
                  onChange={(e) => handleReassign(person.id, grant, e.target.value)}
                  aria-label={`Move ${person.full_name} to another ${groupLabel.toLowerCase()}`}
                  className="absolute inset-0 h-full w-full cursor-pointer opacity-0 disabled:cursor-default"
                >
                  {options}
                </select>
              </>
            )}
          </span>
        );
      }
      // Owner-reported (9 Oct 2026, HSY on a phone): a drop-down is as wide
      // as its longest class name, so long class names pushed the chip past
      // the page's right edge. The chip now stops at the row's width and the
      // class name is cut short with "..." instead.
      return (
        <span key={grant.id} className="inline-flex max-w-full min-w-0 items-center gap-1 rounded-md px-2 py-1 text-[11px] font-semibold" style={{ backgroundColor: bg, color: text }}>
          <span className="shrink-0">{showGroupInLabel ? L.servant : label}</span>
          <select
            value={grant.group_id ?? ""}
            disabled={!movable || pending}
            onChange={(e) => handleReassign(person.id, grant, e.target.value)}
            title={grant.group_name ?? "Unassigned"}
            className={`${CLIP} max-w-full bg-transparent text-[11px] font-semibold border-none focus:outline-none disabled:opacity-60`}
            style={{ color: text }}
          >
            {options}
          </select>
        </span>
      );
    }

    if (grant.role === "general_coordinator") {
      return (
        <span key={grant.id} title={label} className="inline-flex max-w-full min-w-0 items-center rounded-md px-2 py-1 text-[11px] font-semibold" style={{ backgroundColor: bg, color: text }}>
          <span className={CLIP}>{label}</span>
        </span>
      );
    }

    return (
      <span key={grant.id} title={label} className="inline-flex max-w-full min-w-0 items-center gap-1 rounded-md px-2 py-1 text-[11px] font-semibold" style={{ backgroundColor: bg, color: text }}>
        <span className={CLIP}>{label}</span>
        {canManageAll && (
          <button
            type="button"
            disabled={pending}
            onClick={() => handleRevoke(person.id, grant)}
            aria-label={`Remove ${label}`}
            className="shrink-0 leading-none disabled:opacity-60"
          >
            ×
          </button>
        )}
      </span>
    );
  }

  function renderAddRoleControl(person: AssignmentPerson) {
    if (!canManageServants) return null;
    if (addingForPerson !== person.id) {
      return (
        <button
          type="button"
          onClick={() => {
            setAddingForPerson(person.id);
            setAddRole(canManageAll ? "read_only" : "servant");
            setAddGroupId("");
            setError(null);
          }}
          aria-label="Add role"
          className="h-5 w-5 flex items-center justify-center rounded border border-[#ddd] text-[#666] leading-none hover:bg-[#f5f5f5]"
        >
          +
        </button>
      );
    }
    return (
      <div className="flex min-w-0 max-w-full items-center gap-1.5 flex-wrap">
        <select value={addRole} onChange={(e) => setAddRole(e.target.value as AddableRole)} className="min-w-0 max-w-full rounded-md border border-[#ddd] px-1.5 py-1 text-[11px]">
          {addableRoles.map((r) => (
            <option key={r} value={r}>
              {ROLE_LABELS[r]}
            </option>
          ))}
        </select>
        <select value={addGroupId} onChange={(e) => setAddGroupId(e.target.value)} className="min-w-0 max-w-full overflow-hidden text-clip rounded-md border border-[#ddd] px-1.5 py-1 text-[11px]">
          {byGrade && addRole === "sub_coordinator" ? (
            <>
              <option value="">Select a grade…</option>
              {sections.map((s) => (
                <option key={s.key} value={s.key}>
                  {s.label} ({s.groupIds.length} {groupWord}
                  {s.groupIds.length === 1 ? "" : "s"})
                </option>
              ))}
            </>
          ) : (
            <>
              <option value="">{addRole === "servant" && canManageAll ? "Unassigned" : "Select a group…"}</option>
              {myGroups.map((g) => (
                <option key={g.id} value={g.id}>
                  {g.name}
                </option>
              ))}
            </>
          )}
        </select>
        <button type="button" disabled={pending} onClick={() => handleAddRole(person)} className="rounded-md bg-brand px-2 py-1 text-[11px] font-semibold text-white hover:bg-brand-dark disabled:opacity-60">
          Add
        </button>
        <button type="button" onClick={() => setAddingForPerson(null)} className="rounded-md px-2 py-1 text-[11px] font-semibold text-[#666] hover:bg-[#f5f5f5]">
          Cancel
        </button>
      </div>
    );
  }

  /** Alphabetical view: a Coordinator of several classes gets one chip
   * ("Coordinator Gr12 Girls") instead of one per class (owner-requested,
   * 9 Oct 2026); its x removes them all. */
  function renderAlphabeticalChips(person: AssignmentPerson) {
    // Grade-level grants (0106): one chip per grade, e.g. "Steward Gr9 Girls".
    const { bg, text } = chipColor("sub_coordinator");
    const scopeChips: React.ReactNode[] = [];
    const seen = new Set<string>();
    for (const g of person.grants) {
      if (!g.scope || seen.has(g.scope.id)) continue;
      seen.add(g.scope.id);
      const label = `${ROLE_LABELS.sub_coordinator} ${scopeLabel(g.scope)}`;
      scopeChips.push(
        <span key={`scope-${g.scope.id}`} title={label} className="inline-flex max-w-full min-w-0 items-center gap-1 rounded-md px-2 py-1 text-[11px] font-semibold" style={{ backgroundColor: bg, color: text }}>
          <span className={CLIP}>{label}</span>
          {canManageAll && (
            <button type="button" disabled={pending} onClick={() => handleRevoke(person.id, g)} aria-label={`Remove ${label}`} className="shrink-0 leading-none disabled:opacity-60">
              ×
            </button>
          )}
        </span>,
      );
    }
    const others = person.grants.filter((g) => !g.scope);
    const coord = others.filter((g) => g.role === "sub_coordinator" && g.group_name);
    if (coord.length < 2) {
      return (
        <>
          {scopeChips}
          {others.map((g) => renderChip(person, g, true))}
        </>
      );
    }
    const label = `${ROLE_LABELS.sub_coordinator} ${combinedClassName(coord.map((g) => g.group_name!))}`;
    const full = coord.map((g) => g.group_name).join(", ");
    return (
      <>
        {scopeChips}
        {others.filter((g) => !coord.includes(g)).map((g) => renderChip(person, g, true))}
        <span key="coord" title={full} className="inline-flex max-w-full min-w-0 items-center gap-1 rounded-md px-2 py-1 text-[11px] font-semibold" style={{ backgroundColor: bg, color: text }}>
          <span className={CLIP}>{label}</span>
          {canManageAll && (
            <button
              type="button"
              disabled={pending}
              onClick={() => handleRevokeMany(person.id, coord)}
              aria-label={`Remove ${ROLE_LABELS.sub_coordinator} of ${full}`}
              className="shrink-0 leading-none disabled:opacity-60"
            >
              ×
            </button>
          )}
        </span>
      </>
    );
  }

  function renderPersonRow({ person, grants }: Row) {
    return (
      <div key={person.id} className="py-2.5 flex items-center gap-3">
        <Avatar person={person} />
        {/* Owner-reported (mobile): a person with several role chips could
            squeeze this name down to nothing -- `flex-1 min-w-0` has no
            floor, so the chips span (which never shrinks below its own
            content) won a width fight against the name for it every time.
            The Alphabetical view never had this problem because its name
            column is a fixed, never-shrinking width instead -- matched
            here (w-32 shrink-0), with the chips span now flex-1 so IT
            absorbs the remaining space and wraps, not the name. */}
        <span className="w-32 shrink-0 font-semibold text-[#333] truncate">{person.full_name}</span>
        <span className="flex-1 min-w-0 flex items-center gap-1.5 flex-wrap justify-end">
          {grants.map((g) => renderChip(person, g, false))}
          {renderAddRoleControl(person)}
        </span>
      </div>
    );
  }

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
          <button type="button" onClick={() => setViewMode("categorical")} className={`px-3 py-2 font-semibold ${viewMode === "categorical" ? "bg-brand text-white" : "bg-white text-[#333]"}`}>
            Categorical
          </button>
          <button type="button" onClick={() => setViewMode("alphabetical")} className={`px-3 py-2 font-semibold ${viewMode === "alphabetical" ? "bg-brand text-white" : "bg-white text-[#333]"}`}>
            Alphabetical
          </button>
        </div>
      </div>

      {!canManageServants && <p className="text-xs text-[#666]">Only {L.generalCoordinators}/Admins can grant, reassign, or revoke roles here.</p>}
      {coordinatorOnly && (
        <p className="text-xs text-[#666]">
          You can add {L.servantsLower} to the {myGroupIds.length === 1 ? "group" : "groups"} you coordinate and move them in or
          out. Other changes are made by {L.generalCoordinators}/Admins.
        </p>
      )}
      {error && <p className="text-sm text-[#dc3545]">{error}</p>}

      {viewMode === "categorical" ? (
        <div className="space-y-4">
          {categoricalBuckets.cohorts.map((bucket) => {
            const servingRows = bucket.rows.filter(isServingRow);
            const readOnlyRows = bucket.rows.filter((r) => !isServingRow(r));
            const { female, male, other } = groupByGender(servingRows, (r) => r.person.gender);
            return (
              <div key={bucket.key} className="rounded-xl bg-white shadow-[0_4px_20px_rgba(0,0,0,0.06)] p-4">
                <h3 className="text-sm font-bold text-brand mb-3">{bucket.label}</h3>
                {bucket.rows.length === 0 ? (
                  <p className="py-3 text-xs text-[#666]">No one here yet.</p>
                ) : (
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
                            <h4 className="text-[11px] font-bold text-[#666] uppercase tracking-wide mb-1.5">
                              {genderSubheading(kind, rows.length, L)}
                            </h4>
                            <div className="divide-y divide-[#f0f0f0]">{rows.map(renderPersonRow)}</div>
                          </div>
                        ),
                    )}
                    {readOnlyRows.length > 0 && (
                      <div>
                        <h4 className="text-[11px] font-bold text-[#666] uppercase tracking-wide mb-1.5">
                          {readOnlyRows.length} Read-only Access
                        </h4>
                        <div className="divide-y divide-[#f0f0f0]">{readOnlyRows.map(renderPersonRow)}</div>
                      </div>
                    )}
                  </div>
                )}
                {isMine(bucket.groupId) && (
                  <BringSomeoneNew
                    open={addingForGroup === bucket.groupId}
                    onOpen={() => {
                      setAddingForGroup(bucket.groupId);
                      setBringUserId("");
                      setBringRole("servant");
                      setError(null);
                    }}
                    onClose={() => setAddingForGroup(null)}
                    candidates={roster.filter((p) => p.grants.every((g) => g.group_id !== bucket.groupId))}
                    bringUserId={bringUserId}
                    setBringUserId={setBringUserId}
                    bringRole={bringRole}
                    setBringRole={setBringRole}
                    onSubmit={() => handleBringSomeoneNew(bucket.groupId)}
                    pending={pending}
                    roles={addableRoles}
                    coordinatorNote={
                      byGrade
                        ? (() => {
                            const g = sortedGroups.find((x) => x.id === bucket.groupId);
                            const s = g ? sectionOfGroup(g, coordinatorScope) : null;
                            return s ? `All of ${sectionLabel(s.ladder_position, s.gender_label, sortedGroups, ladderLabel, levelOffset)}` : undefined;
                          })()
                        : undefined
                    }
                  />
                )}
              </div>
            );
          })}

          {categoricalBuckets.generalCoordinators.length > 0 && (
            <BucketCard label={L.generalCoordinators} rows={categoricalBuckets.generalCoordinators} renderChip={renderChip} renderAddRoleControl={renderAddRoleControl} />
          )}

          {categoricalBuckets.unassigned.length > 0 && (
            <BucketCard label={`Unassigned to a ${groupLabel}`} rows={categoricalBuckets.unassigned} renderChip={renderChip} renderAddRoleControl={renderAddRoleControl} />
          )}
        </div>
      ) : (
        <div className="rounded-xl bg-white shadow-[0_4px_20px_rgba(0,0,0,0.06)] p-4 divide-y divide-[#f0f0f0]">
          {alphabetical.map((person) => (
            <div key={person.id} className="py-2.5 flex items-center gap-3">
              <Avatar person={person} />
              <span className="w-32 shrink-0 font-semibold text-[#333] truncate">{person.full_name}</span>
              <span className="flex-1 min-w-0 flex items-center gap-1.5 flex-wrap">
                {renderAlphabeticalChips(person)}
                {renderAddRoleControl(person)}
              </span>
            </div>
          ))}
          {alphabetical.length === 0 && <p className="py-8 text-sm text-[#666] text-center">No {L.servantsLower} match.</p>}
        </div>
      )}
    </div>
  );
}

function Avatar({ person }: { person: AssignmentPerson }) {
  const photoUrl = servantPhotoUrl(person.photo_path);
  return (
    <div className="h-10 w-10 shrink-0 rounded-full bg-brand text-white text-sm font-bold flex items-center justify-center overflow-hidden">
      {photoUrl ? (
        // eslint-disable-next-line @next/next/no-img-element
        <img loading="lazy" src={photoUrl} alt={person.full_name} className="h-full w-full object-cover" />
      ) : (
        initials(person.full_name)
      )}
    </div>
  );
}

function BucketCard({
  label,
  rows,
  renderChip,
  renderAddRoleControl,
}: {
  label: string;
  rows: { person: AssignmentPerson; grants: RoleGrant[] }[];
  renderChip: (person: AssignmentPerson, grant: RoleGrant, showGroupInLabel: boolean) => React.ReactNode;
  renderAddRoleControl: (person: AssignmentPerson) => React.ReactNode;
}) {
  const L = useRoleLabels();
  return (
    <div className="rounded-xl bg-white shadow-[0_4px_20px_rgba(0,0,0,0.06)] p-4">
      <h3 className="text-sm font-bold text-brand mb-3">{label}</h3>
      <div className="divide-y divide-[#f0f0f0]">
        {rows.map(({ person, grants }) => (
          <div key={person.id} className="py-2.5 flex items-center gap-3">
            <Avatar person={person} />
            {/* Same fixed-width name column fix as renderPersonRow above. */}
            <span className="w-32 shrink-0 font-semibold text-[#333] truncate">{person.full_name}</span>
            <span className="flex-1 min-w-0 flex items-center gap-1.5 flex-wrap justify-end">
              {grants.map((g) => renderChip(person, g, false))}
              {label !== L.generalCoordinators && renderAddRoleControl(person)}
            </span>
          </div>
        ))}
      </div>
    </div>
  );
}

function BringSomeoneNew({
  open,
  onOpen,
  onClose,
  candidates,
  bringUserId,
  setBringUserId,
  bringRole,
  setBringRole,
  onSubmit,
  pending,
  roles,
  coordinatorNote,
}: {
  open: boolean;
  onOpen: () => void;
  onClose: () => void;
  candidates: AssignmentPerson[];
  bringUserId: string;
  setBringUserId: (id: string) => void;
  bringRole: AddableRole;
  setBringRole: (r: AddableRole) => void;
  onSubmit: () => void;
  pending: boolean;
  /** The roles this person may give (Coordinators: Servant only). */
  roles: readonly AddableRole[];
  /** Grade-level Coordinators (0106): "All of Gr9 Girls". */
  coordinatorNote?: string;
}) {
  const L = useRoleLabels();
  const ROLE_LABELS = roleChipLabels(L);
  if (!open) {
    return (
      <button type="button" onClick={onOpen} className="mt-3 w-full rounded-md border border-dashed border-[#ddd] px-3 py-1.5 text-xs font-semibold text-[#666] hover:bg-[#f5f5f5]">
        + Bring someone new in
      </button>
    );
  }
  return (
    <div className="mt-3 flex flex-wrap items-center gap-1.5 border-t border-[#f0f0f0] pt-3">
      <select value={bringUserId} onChange={(e) => setBringUserId(e.target.value)} className="rounded-md border border-[#ddd] px-2 py-1.5 text-xs flex-1 min-w-[140px]">
        <option value="">Select a person…</option>
        {candidates.map((p) => (
          <option key={p.id} value={p.id}>
            {p.full_name}
          </option>
        ))}
      </select>
      <select value={bringRole} onChange={(e) => setBringRole(e.target.value as AddableRole)} className="rounded-md border border-[#ddd] px-2 py-1.5 text-xs">
        {roles.map((r) => (
          <option key={r} value={r}>
            {ROLE_LABELS[r]}
          </option>
        ))}
      </select>
      {bringRole === "sub_coordinator" && coordinatorNote && <span className="text-[11px] text-[#666]">{coordinatorNote}</span>}
      <button type="button" disabled={pending} onClick={onSubmit} className="rounded-md bg-brand px-3 py-1.5 text-xs font-semibold text-white hover:bg-brand-dark disabled:opacity-60">
        Add
      </button>
      <button type="button" onClick={onClose} className="rounded-md px-3 py-1.5 text-xs font-semibold text-[#666] hover:bg-[#f5f5f5]">
        Cancel
      </button>
    </div>
  );
}
