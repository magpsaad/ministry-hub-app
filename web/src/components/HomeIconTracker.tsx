"use client";

import { useEffect } from "react";
import { noteHomeIconAction } from "@/lib/home-icon-actions";

const KEY = "home-icon-noted";

/** Owner-approved (10 Oct 2026, migration 0110): when the app is running
 * from its home screen icon (not a browser tab), note it once per visit so
 * Audit Logs -> Device setup can show a check mark. Renders nothing. */
export function HomeIconTracker() {
  useEffect(() => {
    const fromIcon =
      window.matchMedia?.("(display-mode: standalone)").matches ||
      (navigator as Navigator & { standalone?: boolean }).standalone === true;
    if (!fromIcon) return;
    try {
      if (sessionStorage.getItem(KEY)) return;
      sessionStorage.setItem(KEY, "1");
    } catch {
      // Storage blocked: just note it (cheap, and only once per page load).
    }
    void noteHomeIconAction();
  }, []);
  return null;
}
