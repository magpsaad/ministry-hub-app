"use client";

import { useEffect, useState } from "react";
import { usePathname } from "next/navigation";
import { getPushPromptContext, savePushSubscription } from "@/app/settings/notifications/actions";
import { deviceLabel, isAppleMobile, isInstalledApp } from "@/lib/device-label";
import { claimPromptSlot, releasePromptSlot } from "@/lib/prompt-slot";
import { NotificationsSetupPanel } from "./NotificationsSetupPanel";
import { currentSubscription, pushCapable } from "./usePushSetup";

/** Owner-requested (6 Oct 2026): everyone already using the app is asked,
 * once per device, to turn notifications on (with the Home Screen step on
 * iPhones). "Not now" asks again in 7 days; "Don't ask again" leaves it to
 * My Settings -> Notifications. The answer is remembered on the device -- notifications
 * are per device anyway. Never on the check-in posters, sign-in, onboarding
 * Account Security or My Settings pages (they have their own), nor on the
 * console. */

const KEY = "mh_notif_prompt";
const LATER_DAYS = 7;
const RESAVE_KEY = "mh_notif_resaved";
const EXCLUDED = ["/login", "/auth", "/checkin", "/security", "/settings", "/register", "/console", "/address-not-set-up", "/ministry-inactive"];

type Answer = { s: "on" | "later" | "never"; until?: number };

function readAnswer(): Answer | null {
  try {
    const raw = localStorage.getItem(KEY);
    return raw ? (JSON.parse(raw) as Answer) : null;
  } catch {
    return null;
  }
}

function writeAnswer(a: Answer) {
  try {
    localStorage.setItem(KEY, JSON.stringify(a));
  } catch {
    // Private browsing: it may be asked again next visit.
  }
}

/** True once this device has answered the prompt (or has notifications on). */
function notificationPromptSettled(): boolean {
  const a = readAnswer();
  return !!a && (a.s !== "later" || (a.until ?? 0) > Date.now());
}

export function NotificationsPrompt() {
  const pathname = usePathname();
  const excluded = EXCLUDED.some((p) => pathname === p || pathname.startsWith(`${p}/`));
  const [publicKey, setPublicKey] = useState<string | null>(null);
  const [show, setShow] = useState(false);
  // Answered on this visit: keeps the bottom of the screen to itself, so the
  // Face ID suggestion waits for another visit.
  const [done, setDone] = useState(false);

  useEffect(() => {
    if (excluded || show || done) return;
    // Hold the bottom of the screen while deciding, so the Face ID
    // suggestion doesn't appear underneath; given back if not asking.
    if (!claimPromptSlot("notifications")) return;
    let cancelled = false;
    let asking = false;
    const timer = window.setTimeout(async () => {
      try {
        const sub = await currentSubscription();
        if (sub) {
          // Already on: keep the server's copy of it fresh (once a day).
          writeAnswer({ s: "on" });
          const today = new Date().toDateString();
          if (localStorage.getItem(RESAVE_KEY) !== today) {
            localStorage.setItem(RESAVE_KEY, today);
            void savePushSubscription(sub.toJSON(), deviceLabel());
          }
          return;
        }
        if (notificationPromptSettled()) return;
        // An iPhone in Safari can't yet, but is shown the Home Screen step;
        // a browser that never can (or was told no) isn't asked.
        const homeScreenStep = isAppleMobile() && !isInstalledApp();
        if (!pushCapable() && !homeScreenStep) return;
        if (pushCapable() && Notification.permission === "denied") return;
        const ctx = await getPushPromptContext();
        if (cancelled || !ctx.ask || !ctx.publicKey) return;
        asking = true;
        setPublicKey(ctx.publicKey);
        setShow(true);
      } catch {
        // No storage, no answer: just don't ask this time.
      } finally {
        if (!asking && !cancelled) releasePromptSlot("notifications");
      }
    }, 1500);
    return () => {
      cancelled = true;
      window.clearTimeout(timer);
      if (!asking) releasePromptSlot("notifications");
    };
  }, [excluded, pathname, show, done]);

  if (!show || excluded) return null;

  function answered(a: "on" | "later" | "never") {
    writeAnswer(a === "later" ? { s: "later", until: Date.now() + LATER_DAYS * 86_400_000 } : { s: a });
    setDone(true);
    if (a === "on") window.setTimeout(() => setShow(false), 2500);
    else setShow(false);
  }

  return (
    <div className="fixed inset-x-0 bottom-4 z-[950] flex justify-center px-4" role="dialog" aria-label="Turn on notifications">
      <div className="w-full max-w-md rounded-xl bg-white px-4 py-4 shadow-[0_4px_24px_rgba(0,0,0,0.18)]">
        <NotificationsSetupPanel publicKey={publicKey} onAnswered={answered} withDismiss />
      </div>
    </div>
  );
}
