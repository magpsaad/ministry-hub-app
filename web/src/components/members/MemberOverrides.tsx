"use client";

import { createContext, useContext } from "react";
import type { MemberListItem } from "@/lib/members";

/** What a save in the Member Detail modal changed, in the list's own shape,
 * plus `deleted` for a record that's gone. */
export type MemberPatch = Partial<Omit<MemberListItem, "id">> & { deleted?: boolean };

/** Owner-reported (QA S-3/R-2): after saving a youth's details or photo, the
 * list kept showing the old values for a few seconds until the server's
 * refreshed copy arrived. The Member List provides this so the modal can
 * apply its change to the card immediately; the refreshed server data then
 * replaces it. Absent (null) anywhere outside the Member List -- saving
 * there simply waits for the refresh, as before. */
export const MemberOverridesContext = createContext<{ apply: (memberId: string, patch: MemberPatch) => void } | null>(null);

export function useMemberOverrides() {
  return useContext(MemberOverridesContext);
}
