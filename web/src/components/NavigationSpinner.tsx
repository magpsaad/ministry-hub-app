"use client";

import { useEffect, useState } from "react";
import { LoadingSpinner } from "@/components/LoadingSpinner";

/**
 * Owner-reported (10 Oct 2026): opening a page -- tapping the logo to go
 * back to the Dashboard above all -- could take a couple of seconds with
 * nothing on screen to say anything was happening. Every move to another
 * page now shows the spinner straight away (after a short pause, so quick
 * ones don't flash it), until that page or its loading screen (which shows
 * the same spinner, in the same place) is up.
 *
 * Covers every link in the app without touching each one: a click on any
 * link to another page of this app starts it. Code that moves on without a
 * link (router.push) calls startNavigationSpinner(). The page counts as
 * arrived when the browser address is updated, which Next.js does once the
 * new page (or its loading screen) is on screen.
 */

let start: (() => void) | null = null;

/** For code that changes page with router.push instead of a link. */
export function startNavigationSpinner() {
  start?.();
}

export function NavigationSpinner() {
  const [shown, setShown] = useState(false);

  useEffect(() => {
    let showTimer: number | undefined;
    let giveUpTimer: number | undefined;

    function stop() {
      window.clearTimeout(showTimer);
      window.clearTimeout(giveUpTimer);
      showTimer = giveUpTimer = undefined;
      setShown(false);
    }
    function begin() {
      window.clearTimeout(showTimer);
      window.clearTimeout(giveUpTimer);
      showTimer = window.setTimeout(() => setShown(true), 150);
      // Never left spinning if something goes wrong on the way.
      giveUpTimer = window.setTimeout(stop, 20000);
    }
    start = begin;

    // Capture phase: runs before the link's own handler (Next.js's Link
    // cancels the browser's default and moves on itself).
    function onClick(e: MouseEvent) {
      if (e.button !== 0 || e.metaKey || e.ctrlKey || e.shiftKey || e.altKey) return;
      const link = (e.target as Element | null)?.closest?.("a");
      if (!link || !link.href || link.hasAttribute("download")) return;
      if (link.target && link.target !== "_self") return;
      const url = new URL(link.href, window.location.href);
      if (url.origin !== window.location.origin) return; // tel:, mailto:, other sites
      if (url.pathname === window.location.pathname && url.search === window.location.search) return;
      begin();
    }
    document.addEventListener("click", onClick, true);

    // Next.js updates the address once the new page is showing. (Stopped
    // a moment later: React doesn't allow updates from inside that step.)
    const push = window.history.pushState;
    const replace = window.history.replaceState;
    window.history.pushState = function (...args: Parameters<History["pushState"]>) {
      push.apply(this, args);
      if (showTimer !== undefined || giveUpTimer !== undefined) window.setTimeout(stop, 0);
    };
    window.history.replaceState = function (...args: Parameters<History["replaceState"]>) {
      replace.apply(this, args);
      if (showTimer !== undefined || giveUpTimer !== undefined) window.setTimeout(stop, 0);
    };
    // Browser Back/Forward lands on its own; nothing to wait for here.
    window.addEventListener("popstate", stop);

    return () => {
      start = null;
      document.removeEventListener("click", onClick, true);
      window.removeEventListener("popstate", stop);
      window.history.pushState = push;
      window.history.replaceState = replace;
      window.clearTimeout(showTimer);
      window.clearTimeout(giveUpTimer);
    };
  }, []);

  return shown ? <LoadingSpinner /> : null;
}
