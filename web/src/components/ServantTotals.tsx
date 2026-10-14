"use client";

import { useRoleLabels } from "@/components/RoleLabelsProvider";

/** Owner-requested (14 Oct 2026): the same breakdown at the top of Servant
 * Profiles and Servant Assignments, so the two totals always agree and add
 * up -- "76 in total: 66 Servants, 7 Stewards, 3 General Coordinators".
 * Each person is counted once: as a Servant if they hold any Servant grant,
 * else as a Coordinator (HSY Steward), else as a General Coordinator. A
 * group with nobody in it is left out. */
export function ServantTotals({ servants, coordinators, generalCoordinators }: { servants: number; coordinators: number; generalCoordinators: number }) {
  const L = useRoleLabels();
  const total = servants + coordinators + generalCoordinators;
  const parts: [number, string][] = [
    [servants, servants === 1 ? L.servant : L.servants],
    [coordinators, coordinators === 1 ? L.coordinator : L.coordinators],
    [generalCoordinators, generalCoordinators === 1 ? L.generalCoordinator : L.generalCoordinators],
  ];
  const shown = parts.filter(([n], i) => i === 0 || n > 0);
  return (
    <p className="text-sm text-[#555]">
      <strong>{total}</strong> in total:{" "}
      {shown.map(([n, word], i) => (
        <span key={word}>
          {i > 0 && ", "}
          <strong>{n}</strong> {word}
        </span>
      ))}
    </p>
  );
}

/** The chip on a Coordinator's (HSY Steward's) card -- purple, so it stands
 * out from the card (owner-requested 14 Oct 2026). */
export const COORDINATOR_CHIP = "shrink-0 rounded-full bg-[#f3e5f5] px-2 py-0.5 text-[10px] font-semibold text-[#7b1fa2]";
