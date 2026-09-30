"use client";

import { createContext, useContext } from "react";
import { setSessionFlag, useSessionFlag } from "@/components/useSessionFlag";

export const MY_ASSIGNED_STORAGE_KEY = "myAssignedOnly";
const STORAGE_KEY = MY_ASSIGNED_STORAGE_KEY;

const MyAssignedCtx = createContext<{ myAssignedOnly: boolean; toggle: () => void; hydrated: boolean }>({
  myAssignedOnly: false,
  toggle: () => {},
  hydrated: false,
});

/**
 * REQUIREMENTS.md §6.2 -- "My Assigned List" persists per browser session
 * and filters every list/stat/table app-wide. Lifted to a single provider
 * (at the group layout level) so every tab -- the nav shell's checkbox, the
 * Member List, the Dashboard, and eventually Attendance/Outreach/Analytics
 * -- shares the same live state instead of each independently re-reading
 * sessionStorage (which wouldn't react to a toggle happening elsewhere on
 * the same page).
 */
export function MyAssignedProvider({ children }: { children: React.ReactNode }) {
  const stored = useSessionFlag(STORAGE_KEY);
  const hydrated = stored !== null;
  const myAssignedOnly = stored === true;

  function toggle() {
    setSessionFlag(STORAGE_KEY, !myAssignedOnly);
  }

  return (
    <MyAssignedCtx.Provider value={{ myAssignedOnly, toggle, hydrated }}>{children}</MyAssignedCtx.Provider>
  );
}

export function useMyAssigned() {
  return useContext(MyAssignedCtx);
}
