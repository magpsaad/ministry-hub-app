"use client";

import { useRef, useState } from "react";
import { BusyLabel } from "@/components/PendingButton";
import { isAndroid, usePushSetup } from "./usePushSetup";

const PRIMARY =
  "w-full rounded-md bg-brand py-2.5 text-sm font-semibold text-white hover:bg-brand-dark disabled:opacity-60 shadow-[0_2px_4px_rgba(0,0,0,0.15)]";

/** Owner-requested (6 Oct 2026): the "turn on notifications" panel shown to
 * servants as they onboard and, once, to everyone already using the app.
 * It explains the Home Screen step (iPhones and iPads only get
 * notifications from the app opened from its Home Screen icon), then turns
 * them on for this device. `onAnswered` is told what the person chose. */
export function NotificationsSetupPanel({
  publicKey,
  onAnswered,
  withDismiss = false,
  waitingForApproval = false,
}: {
  publicKey: string | null;
  /** The "waiting for approval" screens: say they'll hear when it happens. */
  waitingForApproval?: boolean;
  onAnswered?: (answer: "on" | "later" | "never") => void;
  /** The one-time prompt: "Not now" and "Don't ask again" buttons. */
  withDismiss?: boolean;
}) {
  const { support, permission, endpoint, turnOn } = usePushSetup(publicKey);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const working = useRef(false);

  async function handleTurnOn() {
    if (working.current) return;
    working.current = true;
    setBusy(true);
    setError(null);
    try {
      await turnOn();
      onAnswered?.("on");
    } catch (e) {
      setError((e as Error)?.message || "Something went wrong. Please try again.");
    } finally {
      working.current = false;
      setBusy(false);
    }
  }

  if (support === "checking") return null;

  return (
    <div className="text-left">
      <h3 className="text-sm font-bold text-[#333]">Get notified on this device</h3>
      {endpoint ? (
        <p className="mt-1 text-sm text-[#155724]">
          Notifications are on for this device.{waitingForApproval && " We’ll let you know here as soon as you’re approved."}
        </p>
      ) : support === "needs-home-screen" ? (
        <div className="mt-1 text-sm text-[#555]">
          <p>
            {waitingForApproval ? "Ministry Hub can let you know as soon as you’re approved, and later" : "Ministry Hub can alert you"} when
            something needs you. On an iPhone or iPad, first add it to your Home Screen:
          </p>
          <ol className="mt-1 list-decimal space-y-0.5 pl-5">
            <li>
              Tap the <strong>Share</strong> button in Safari (the square with an arrow).
            </li>
            <li>
              Choose <strong>Add to Home Screen</strong>, then <strong>Add</strong>.
            </li>
            <li>Open Ministry Hub from the new icon and turn notifications on there.</li>
          </ol>
        </div>
      ) : support === "unsupported" ? (
        <p className="mt-1 text-sm text-[#777]">This browser can&rsquo;t show notifications. Try Chrome or Safari on your phone.</p>
      ) : permission === "denied" ? (
        <p className="mt-1 text-sm text-[#5c4400]">
          Notifications are blocked for this app. Allow them in your phone or browser settings, then turn them on in
          My Settings &rarr; Notifications.
        </p>
      ) : (
        <>
          <p className="mt-1 text-sm text-[#555]">
            {waitingForApproval
              ? "Ministry Hub can let you know on this device as soon as you’re approved, and later when something needs you."
              : "Ministry Hub can send an alert to this device when something needs you."}{" "}
            Your phone will ask you to allow it.
          </p>
          {isAndroid() && (
            <p className="mt-1 text-xs text-[#777]">
              Tip: add Ministry Hub to your Home Screen (browser menu &rarr; Add to Home screen) so it opens like an app.
            </p>
          )}
          <button type="button" onClick={handleTurnOn} disabled={busy || !publicKey} className={`${PRIMARY} mt-3`}>
            <BusyLabel busy={busy} busyText="Follow the prompt on your device…">
              Turn on notifications
            </BusyLabel>
          </button>
        </>
      )}
      {error && <p className="mt-2 rounded-md bg-[#f8d7da] px-3 py-2 text-sm text-[#721c24]">{error}</p>}
      {withDismiss && !endpoint && (
        <div className="mt-3 flex items-center justify-between gap-3 text-sm">
          <button type="button" onClick={() => onAnswered?.("later")} disabled={busy} className="font-semibold text-[#555] hover:underline">
            Not now
          </button>
          <button type="button" onClick={() => onAnswered?.("never")} disabled={busy} className="text-[#888] hover:underline">
            Don&rsquo;t ask again on this device
          </button>
        </div>
      )}
    </div>
  );
}
