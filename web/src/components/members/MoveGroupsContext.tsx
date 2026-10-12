"use client";

import { createContext, useContext } from "react";

/** Owner-approved (11 Oct 2026): a Coordinator (HSY Steward) may move a youth
 * between the groups they coordinate, in their combined view. The group
 * layout provides those group ids; the youth record uses them to unlock its
 * group field. The database allows only groups they have access to anyway
 * (members_update rule). Admins/General Coordinators can move to any group
 * (canDelete) and don't need this. */
const Ctx = createContext<string[]>([]);

export function MoveGroupsProvider({ groupIds, children }: { groupIds: string[]; children: React.ReactNode }) {
  return <Ctx.Provider value={groupIds}>{children}</Ctx.Provider>;
}

export function useMoveGroupIds(): string[] {
  return useContext(Ctx);
}
