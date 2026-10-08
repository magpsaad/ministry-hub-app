"use client";

import { createContext, useContext } from "react";
import { roleLabels, type RoleLabels } from "@/lib/role-labels";

const RoleLabelsContext = createContext<RoleLabels | null>(null);

/** Migration 0097: this ministry's words for "Servant" and "Coordinator"
 * (App Labels), for every client component. Filled once by the root layout,
 * like TimezoneProvider. */
export function RoleLabelsProvider({
  servantLabel,
  subCoordinatorLabel,
  children,
}: {
  servantLabel: string;
  subCoordinatorLabel: string;
  children: React.ReactNode;
}) {
  return (
    <RoleLabelsContext.Provider value={roleLabels(servantLabel, subCoordinatorLabel)}>{children}</RoleLabelsContext.Provider>
  );
}

/** This ministry's role words. Outside the provider (shouldn't happen) the
 * standard words are used rather than failing. */
export function useRoleLabels(): RoleLabels {
  return useContext(RoleLabelsContext) ?? roleLabels();
}
