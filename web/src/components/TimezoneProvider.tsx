"use client";

import { createContext, useContext } from "react";

const TimezoneContext = createContext<string | null>(null);

/** Makes the ministry's configured timezone (App Settings) available to
 * every client component, so displayed dates/times and "today" never fall
 * back to the viewer's own device timezone or a hard-coded zone. Filled
 * once by the root layout. */
export function TimezoneProvider({ timeZone, children }: { timeZone: string; children: React.ReactNode }) {
  return <TimezoneContext.Provider value={timeZone}>{children}</TimezoneContext.Provider>;
}

export function useTimezone(): string {
  const tz = useContext(TimezoneContext);
  if (!tz) throw new Error("useTimezone() used outside <TimezoneProvider>");
  return tz;
}
