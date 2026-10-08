/** Owner-requested (7 Oct 2026, migration 0097): each ministry's own words
 * for its two roles -- App Settings' servant_label ("Servant", "Teacher",
 * "Class Leader", ...) and sub_coordinator_label ("Coordinator", "Grade
 * Coordinator", "Steward", ...). Every visible "Servant" / "Coordinator"
 * in the app comes from here, never typed in. Plural = word + "s" (same
 * rule as the Group and Member labels); the General Coordinator role is
 * "General " + the Coordinator word, and "GC" is its initials. Pure, so
 * server and browser code can both use it. */

export type RoleLabels = {
  /** "Servant" */
  servant: string;
  /** "Servants" */
  servants: string;
  /** "servant" -- mid-sentence */
  servantLower: string;
  /** "servants" */
  servantsLower: string;
  /** "Coordinator" (the sub_coordinator role) */
  coordinator: string;
  coordinators: string;
  coordinatorLower: string;
  coordinatorsLower: string;
  /** "General Coordinator" */
  generalCoordinator: string;
  generalCoordinators: string;
  generalCoordinatorLower: string;
  generalCoordinatorsLower: string;
  /** "GC" -- initials of generalCoordinator ("General Steward" -> "GS") */
  gc: string;
  /** "GCs" */
  gcs: string;
};

export const DEFAULT_SERVANT_LABEL = "Servant";
export const DEFAULT_SUB_COORDINATOR_LABEL = "Coordinator";

/** Lower-cases a label for mid-sentence use, leaving all-capital words
 * (abbreviations like "GC") alone. */
function lower(label: string): string {
  return label
    .split(" ")
    .map((w) => (w.length > 1 && w === w.toUpperCase() ? w : w.toLowerCase()))
    .join(" ");
}

export function roleLabels(servantLabel?: string | null, subCoordinatorLabel?: string | null): RoleLabels {
  const servant = servantLabel?.trim() || DEFAULT_SERVANT_LABEL;
  const coordinator = subCoordinatorLabel?.trim() || DEFAULT_SUB_COORDINATOR_LABEL;
  const generalCoordinator = `General ${coordinator}`;
  const gc = generalCoordinator
    .split(/\s+/)
    .map((w) => w[0]?.toUpperCase() ?? "")
    .join("");
  return {
    servant,
    servants: `${servant}s`,
    servantLower: lower(servant),
    servantsLower: lower(`${servant}s`),
    coordinator,
    coordinators: `${coordinator}s`,
    coordinatorLower: lower(coordinator),
    coordinatorsLower: lower(`${coordinator}s`),
    generalCoordinator,
    generalCoordinators: `${generalCoordinator}s`,
    generalCoordinatorLower: lower(generalCoordinator),
    generalCoordinatorsLower: lower(`${generalCoordinator}s`),
    gc,
    gcs: `${gc}s`,
  };
}

/** Text that comes from the database (error messages, audit descriptions,
 * notification names) still says "Servant", "Coordinator", "General
 * Coordinator" or "GC": swap those words for this ministry's own, keeping
 * plural and capitals. With the standard words it changes nothing. */
export function relabelRoleWords(text: string, L: RoleLabels): string {
  return text.replace(
    /\b(General Coordinators?|general coordinators?|Sub-[Cc]oordinators?|sub-coordinators?|Coordinators?|coordinators?|Servants?|servants?|GCs?)\b/g,
    (w) => {
      const plural = w.endsWith("s");
      const capital = w[0] === w[0].toUpperCase();
      if (/^GCs?$/.test(w)) return plural ? L.gcs : L.gc;
      if (/^general/i.test(w)) {
        if (capital) return plural ? L.generalCoordinators : L.generalCoordinator;
        return plural ? L.generalCoordinatorsLower : L.generalCoordinatorLower;
      }
      if (/coordinator/i.test(w)) {
        if (capital) return plural ? L.coordinators : L.coordinator;
        return plural ? L.coordinatorsLower : L.coordinatorLower;
      }
      if (capital) return plural ? L.servants : L.servant;
      return plural ? L.servantsLower : L.servantLower;
    },
  );
}
