import type { MenuData } from "@/lib/menu-types";

/**
 * Owner-reported: the side menu took too long to appear. Its data is now
 * fetched quietly in the background once the page settles (MenuButton),
 * kept here for the whole browser tab session (sessionStorage, so it
 * survives full page reloads too), and shown instantly when the burger is
 * tapped -- then refreshed in the background so counts like Pending
 * Servants stay current. Cleared on sign-out and on the sign-in page, so
 * one person's menu is never shown to the next person on a shared device.
 */

const STORAGE_KEY = "side-menu-v1";

let cached: MenuData | null | undefined; // undefined = sessionStorage not read yet
let inflight: Promise<"ok" | "signed-out" | "error"> | null = null;
let refreshedThisPageLoad = false;
const listeners = new Set<() => void>();

function notify() {
  listeners.forEach((l) => l());
}

export function subscribeMenuData(listener: () => void) {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

export function getMenuDataSnapshot(): MenuData | null {
  if (cached === undefined) {
    try {
      const raw = sessionStorage.getItem(STORAGE_KEY);
      cached = raw ? (JSON.parse(raw) as MenuData) : null;
    } catch {
      cached = null;
    }
  }
  return cached;
}

export function getMenuDataServerSnapshot(): MenuData | null {
  return null;
}

/**
 * Fetches fresh menu data. Without `force`, does nothing if it already
 * ran once since this page loaded (the background prefetch). Concurrent
 * calls share one request.
 */
export function refreshMenuData({ force = false } = {}): Promise<"ok" | "signed-out" | "error"> {
  if (inflight) return inflight;
  if (refreshedThisPageLoad && !force) return Promise.resolve("ok");

  inflight = (async () => {
    try {
      // "manual": a signed-out request is redirected to /login by the
      // proxy; that shows up here as an opaque redirect, not a page.
      const res = await fetch("/api/menu", { cache: "no-store", redirect: "manual" });
      if (res.type === "opaqueredirect" || res.status === 401) {
        clearMenuData();
        return "signed-out";
      }
      if (!res.ok) return "error";
      const data = (await res.json()) as MenuData;
      cached = data;
      refreshedThisPageLoad = true;
      try {
        sessionStorage.setItem(STORAGE_KEY, JSON.stringify(data));
      } catch {
        // Storage unavailable (e.g. private browsing): the in-memory copy still works.
      }
      notify();
      return "ok";
    } catch {
      return "error";
    } finally {
      inflight = null;
    }
  })();
  return inflight;
}

export function clearMenuData() {
  cached = null;
  refreshedThisPageLoad = false;
  try {
    sessionStorage.removeItem(STORAGE_KEY);
  } catch {
    // Storage unavailable; nothing was stored.
  }
  notify();
}
