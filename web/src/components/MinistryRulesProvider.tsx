"use client";

import { createContext, useContext } from "react";

export type MinistryRules = { readOnlyCanAddPhotos: boolean };

const MinistryRulesContext = createContext<MinistryRules>({ readOnlyCanAddPhotos: true });

/** Migration 0118: this ministry's Read-only Access switches that client
 * components need (filled once by the root layout, like RoleLabelsProvider). */
export function MinistryRulesProvider({ rules, children }: { rules: MinistryRules; children: React.ReactNode }) {
  return <MinistryRulesContext.Provider value={rules}>{children}</MinistryRulesContext.Provider>;
}

export function useMinistryRules(): MinistryRules {
  return useContext(MinistryRulesContext);
}
