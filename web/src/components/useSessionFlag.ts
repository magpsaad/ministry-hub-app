import { useSyncExternalStore } from "react";

/**
 * A true/false setting kept in sessionStorage for this browser tab (e.g.
 * "My Assigned List", a collapsed Dashboard section), read the way React
 * recommends for outside data: with useSyncExternalStore, instead of
 * reading it in an effect and setting state -- which drew every such
 * component twice on load (lint: react-hooks/set-state-in-effect).
 *
 * Returns null while the page is being hydrated (the server can't see
 * sessionStorage), then the real value.
 */
const listeners = new Set<() => void>();

function subscribe(listener: () => void) {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

function read(key: string): boolean {
  try {
    return sessionStorage.getItem(key) === "true";
  } catch {
    return false; // sessionStorage unavailable (e.g. private browsing)
  }
}

export function useSessionFlag(key: string): boolean | null {
  return useSyncExternalStore(
    subscribe,
    () => read(key),
    () => null,
  );
}

export function setSessionFlag(key: string, value: boolean) {
  try {
    sessionStorage.setItem(key, String(value));
  } catch {
    // Unavailable storage: nothing to persist.
  }
  listeners.forEach((l) => l());
}

/** Same as useSessionFlag, for a text value ("" when unset; null while
 * hydrating). */
export function useSessionString(key: string): string | null {
  return useSyncExternalStore(
    subscribe,
    () => {
      try {
        return sessionStorage.getItem(key) ?? "";
      } catch {
        return "";
      }
    },
    () => null,
  );
}

export function setSessionString(key: string, value: string) {
  try {
    sessionStorage.setItem(key, value);
  } catch {
    // Unavailable storage: nothing to persist.
  }
  listeners.forEach((l) => l());
}
