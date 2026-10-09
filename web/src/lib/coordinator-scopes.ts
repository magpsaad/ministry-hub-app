/** Coordinators of a grade (owner-approved 9 Oct 2026, migration 0106).
 * A ministry's Ministry Settings say what a Coordinator is assigned to:
 * each group (the default), a grade (every group at one level) or a grade
 * and gender (e.g. Grade 9 Girls). A grade-level grant is one
 * coordinator_scopes row; the database keeps the per-group grants under it
 * in step with the groups there. Pure, so server and browser code share it. */

export type CoordinatorScopeMode = "group" | "grade" | "grade_gender";

/** A grade-level grant, as attached to each of its per-group grants. */
export type ScopeRef = { id: string; ladder_position: number; gender_label: string | null };

type LevelGroup = { id: string; name: string; ladder_position: number; gender_label?: string | null; kind: string };

/** One grade (or grade + gender) a Coordinator can be given. */
export type Section = {
  /** "<level>|<gender or empty>" -- the value of a <select> option. */
  key: string;
  ladder_position: number;
  gender_label: string | null;
  label: string;
  groupIds: string[];
};

/** "Gr9 Girls" / "Yr 3": the ministry's level word and number (+ gender).
 * No space when the groups there are named that way ("Gr9 Girls St.
 * Marina"), else one ("Yr 3"). */
export function sectionLabel(
  ladderPosition: number,
  gender: string | null,
  groups: LevelGroup[],
  ladderLabel: string,
  levelOffset: number,
): string {
  const n = ladderPosition + levelOffset;
  const word = ladderLabel.trim();
  const tight = word !== "" && groups.some((g) => g.ladder_position === ladderPosition && g.name.startsWith(`${word}${n}`));
  const level = word === "" ? String(n) : tight ? `${word}${n}` : `${word} ${n}`;
  return gender ? `${level} ${gender}` : level;
}

export function sectionKey(ladderPosition: number, gender: string | null): string {
  return `${ladderPosition}|${gender ?? ""}`;
}

export function parseSectionKey(key: string): { ladder_position: number; gender_label: string | null } {
  const [pos, gender] = key.split("|");
  return { ladder_position: Number(pos), gender_label: gender ? gender : null };
}

/** The section a group belongs to under this mode (null: per-group mode). */
export function sectionOfGroup(
  group: { ladder_position: number; gender_label?: string | null },
  mode: CoordinatorScopeMode,
): { ladder_position: number; gender_label: string | null } | null {
  if (mode === "group") return null;
  return { ladder_position: group.ladder_position, gender_label: mode === "grade_gender" ? (group.gender_label ?? null) : null };
}

/** Every section there is now, by level then gender (regular groups only). */
export function sectionsFor(groups: LevelGroup[], mode: CoordinatorScopeMode, ladderLabel: string, levelOffset: number): Section[] {
  if (mode === "group") return [];
  const regular = groups.filter((g) => g.kind === "regular");
  const byKey = new Map<string, Section>();
  for (const g of regular) {
    const s = sectionOfGroup(g, mode)!;
    const key = sectionKey(s.ladder_position, s.gender_label);
    if (!byKey.has(key)) {
      byKey.set(key, {
        key,
        ladder_position: s.ladder_position,
        gender_label: s.gender_label,
        label: sectionLabel(s.ladder_position, s.gender_label, regular, ladderLabel, levelOffset),
        groupIds: [],
      });
    }
    byKey.get(key)!.groupIds.push(g.id);
  }
  return [...byKey.values()].sort(
    (a, b) => a.ladder_position - b.ladder_position || (a.gender_label ?? "").localeCompare(b.gender_label ?? ""),
  );
}
