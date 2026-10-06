"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { platformAuthenticatorIsAvailable } from "@simplewebauthn/browser";
import { UnlockPanel } from "@/components/UnlockPanel";
import { claimPromptSlot } from "@/lib/prompt-slot";
import { ACTIVITY_PING_MS, isLockExempt, type LockStatus, type UnlockMethods } from "@/lib/screen-lock";

const OFFER_KEY = "mh_faceid_offer";

/** Screen lock (owner-approved 5 Oct 2026, migration 0089). On every
 * signed-in page of a ministry that turned it on (Ministry Settings), the
 * app covers itself after that many minutes without a tap, scroll or key,
 * and while the app is in the background (so nothing shows in the phone's
 * app switcher). The page underneath stays as it was -- a half-typed form
 * is kept -- and comes back after Face ID / fingerprint, the authenticator
 * code, or signing in again. The server refuses every page and save of a
 * locked sign-in too, so this cover is not the only thing in the way. */
export function ScreenLock() {
  const pathname = usePathname();
  const exempt = isLockExempt(pathname);
  const [minutes, setMinutes] = useState<number | null>(null);
  const [locked, setLocked] = useState(false);
  const [offer, setOffer] = useState(false);
  const lastActivity = useRef(0);
  const lastPing = useRef(0);

  const report = useCallback(async () => {
    lastPing.current = Date.now();
    try {
      const res = await fetch("/api/screen-lock", { method: "POST", cache: "no-store" });
      if (!res.ok) return;
      const status = (await res.json()) as LockStatus;
      setMinutes(status.enabled ? status.minutes : null);
      if (status.locked) setLocked(true);
    } catch {
      // Offline for a moment: the timer below still locks on time.
    }
  }, []);

  // Every page load: this address's setting, and this sign-in's state.
  useEffect(() => {
    if (exempt) return;
    lastActivity.current = Date.now();
    const t = window.setTimeout(() => void report(), 0);
    return () => window.clearTimeout(t);
  }, [exempt, pathname, report]);

  // Activity: taps, scrolls and keys (reported at most every 20 seconds).
  useEffect(() => {
    if (exempt || minutes === null || locked) return;
    const onActivity = () => {
      lastActivity.current = Date.now();
      if (Date.now() - lastPing.current > ACTIVITY_PING_MS) void report();
    };
    const events = ["pointerdown", "keydown", "wheel", "touchstart", "scroll"] as const;
    events.forEach((e) => window.addEventListener(e, onActivity, { passive: true, capture: true }));
    const timer = window.setInterval(() => {
      if (Date.now() - lastActivity.current >= minutes * 60_000) setLocked(true);
    }, 5_000);
    return () => {
      events.forEach((e) => window.removeEventListener(e, onActivity, { capture: true }));
      window.clearInterval(timer);
    };
  }, [exempt, minutes, locked, report]);

  // In the background: hidden. Back after the limit (a phone that slept): locked.
  useEffect(() => {
    if (exempt || minutes === null) return;
    const onVisibility = () => {
      const root = document.documentElement;
      if (document.visibilityState === "hidden") {
        root.classList.add("mh-privacy");
        return;
      }
      if (Date.now() - lastActivity.current >= minutes * 60_000) setLocked(true);
      root.classList.remove("mh-privacy");
      void report();
    };
    document.addEventListener("visibilitychange", onVisibility);
    return () => {
      document.removeEventListener("visibilitychange", onVisibility);
      document.documentElement.classList.remove("mh-privacy");
    };
  }, [exempt, minutes, report]);

  // While locked: nothing behind the cover can be scrolled or tabbed to.
  useEffect(() => {
    if (!locked) return;
    const root = document.documentElement;
    root.classList.add("mh-locked");
    return () => root.classList.remove("mh-locked");
  }, [locked]);

  // Offered once per device: Face ID instead of waiting for an email code.
  useEffect(() => {
    if (exempt || minutes === null || locked || pathname.startsWith("/security")) return;
    let cancelled = false;
    // A few seconds later, and only if the notifications prompt isn't
    // showing: one suggestion at a time.
    const timer = window.setTimeout(async () => {
      try {
        if (localStorage.getItem(OFFER_KEY)) return;
        if (!(await platformAuthenticatorIsAvailable())) return;
        const res = await fetch("/api/unlock/methods", { cache: "no-store" });
        if (!res.ok) return;
        const methods = (await res.json()) as UnlockMethods;
        if (!cancelled && !methods.faceId && claimPromptSlot("faceid")) setOffer(true);
      } catch {
        // No local storage (private browsing) or no answer: just don't offer.
      }
    }, 4000);
    return () => {
      cancelled = true;
      window.clearTimeout(timer);
    };
  }, [exempt, minutes, locked, pathname]);

  function dismissOffer() {
    setOffer(false);
    try {
      localStorage.setItem(OFFER_KEY, "dismissed");
    } catch {
      // Private browsing: it may be offered again next time.
    }
  }

  if (exempt) return null;

  if (locked) {
    return createPortal(
      <div
        role="dialog"
        aria-modal="true"
        aria-label="Locked"
        className="fixed inset-0 z-[1000] flex items-center justify-center overflow-y-auto bg-[#f5f5f5] px-4 py-10"
      >
        <UnlockPanel
          onUnlocked={() => {
            lastActivity.current = Date.now();
            lastPing.current = Date.now();
            setLocked(false);
          }}
        />
      </div>,
      document.body,
    );
  }

  if (!offer) return null;
  return (
    <div className="fixed inset-x-0 bottom-4 z-[900] flex justify-center px-4">
      <div className="flex w-full max-w-md items-center gap-3 rounded-xl bg-white px-4 py-3 text-sm text-[#333] shadow-[0_4px_20px_rgba(0,0,0,0.15)]">
        <span className="flex-1">Unlock this app with Face ID or your fingerprint instead of an email code?</span>
        <Link href="/security#face-id" onClick={dismissOffer} className="shrink-0 font-semibold text-brand hover:underline">
          Set it up
        </Link>
        <button type="button" onClick={dismissOffer} className="shrink-0 text-[#777] hover:underline">
          Not now
        </button>
      </div>
    </div>
  );
}
