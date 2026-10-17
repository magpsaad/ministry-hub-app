"use client";

import { useEffect } from "react";
import { usePathname } from "next/navigation";
import { noteHomeIconAction, noteLinkOpenAction } from "@/lib/home-icon-actions";

const KEY = "home-icon-noted";
// Opened from a link: noted once per device (this browser, this address).
const LINK_KEY = "link-open-noted";
// Pages people use before signing in: nothing to note there.
const SIGNED_OUT_PAGES = ["/login", "/auth", "/checkin", "/register", "/security", "/address-not-set-up", "/ministry-inactive"];

/** Owner-approved (10 Oct 2026, migration 0110): when the app is running
 * from its home screen icon (not a browser tab), note it once per visit so
 * Audit Logs -> Device setup can show a check mark. Renders nothing. */
export function HomeIconTracker() {
  const pathname = usePathname();
  useEffect(() => {
    const fromIcon =
      window.matchMedia?.("(display-mode: standalone)").matches ||
      (navigator as Navigator & { standalone?: boolean }).standalone === true;
    // Owner-reported (17 Oct 2026): a new home screen icon starts signed out
    // (an iPhone keeps its own sign-in for it), and noting it from the
    // sign-in page was refused -- then never tried again that visit, so
    // Device setup kept showing an "x". Nothing is noted before sign-in now,
    // and an icon open counts as done only once the database took it.
    if (SIGNED_OUT_PAGES.some((p) => pathname === p || pathname.startsWith(`${p}/`))) return;
    if (!fromIcon) {
      // Owner-requested (12 Oct 2026): opened from a link -- noted once per
      // device, after sign-in, so Device setup can show an "x".
      try {
        if (localStorage.getItem(LINK_KEY)) return;
      } catch {
        return; // No storage: don't ask the server on every page.
      }
      void noteLinkOpenAction().then((ok) => {
        try {
          if (ok) localStorage.setItem(LINK_KEY, "1");
        } catch {
          // Ignore.
        }
      });
      return;
    }
    try {
      if (sessionStorage.getItem(KEY)) return;
    } catch {
      // Storage blocked: just note it (cheap, and only once per page load).
    }
    void noteHomeIconAction().then((ok) => {
      try {
        if (ok) sessionStorage.setItem(KEY, "1");
      } catch {
        // Ignore.
      }
    });
  }, [pathname]);
  return null;
}
