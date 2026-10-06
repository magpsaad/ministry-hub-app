"use client";

import { useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { sendTestNotification } from "./actions";
import { CARD, PRIMARY_BUTTON } from "./shared";
import { BusyLabel } from "@/components/PendingButton";
import { usePushSetup } from "@/components/notifications/usePushSetup";

/** Account Security -> Notifications on this device (migration 0092): turn
 * phone notifications on or off for this device on this ministry's
 * address, and send a test. On an iPhone they only work from the app's
 * Home Screen icon, so that's explained first. */
export function NotificationsCard({
  publicKey,
  savedEndpoints,
  adminOrGc,
}: {
  publicKey: string | null;
  savedEndpoints: string[];
  adminOrGc: boolean;
}) {
  const router = useRouter();
  const push = usePushSetup(publicKey);
  const { support, permission, endpoint } = push;
  const [busy, setBusy] = useState<"on" | "off" | "test" | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const working = useRef(false);

  const on = !!endpoint && savedEndpoints.includes(endpoint);

  async function run(kind: "on" | "off" | "test", task: () => Promise<void>) {
    if (working.current) return;
    working.current = true;
    setBusy(kind);
    setError(null);
    setNotice(null);
    try {
      await task();
    } catch (e) {
      setError((e as Error)?.message || "Something went wrong. Please try again.");
    } finally {
      working.current = false;
      setBusy(null);
    }
  }

  const turnOn = () =>
    run("on", async () => {
      await push.turnOn();
      setNotice("Notifications are on for this device. Tap “Send a test” to check.");
      router.refresh();
    });

  const turnOff = () =>
    run("off", async () => {
      await push.turnOff();
      router.refresh();
    });

  const test = () =>
    run("test", async () => {
      const res = await sendTestNotification();
      if (res.error) throw new Error(res.error);
      setNotice("Sent. It should appear on this device within a few seconds.");
    });

  return (
    <div className={CARD}>
      <h2 className="text-base font-bold text-[#333]">Notifications on this device</h2>
      <p className="mt-1 text-sm text-[#555]">
        {adminOrGc
          ? "Get an alert on your phone when something needs you — for now, when a new servant is waiting for your approval."
          : "Get alerts on your phone from Ministry Hub. More alerts for servants are coming."}
      </p>

      {support === "checking" && <p className="mt-3 text-sm text-[#888]">One moment&hellip;</p>}

      {support === "needs-home-screen" && (
        <div className="mt-3 rounded-md bg-[#f0f4f8] px-3 py-2 text-sm text-[#333]">
          On an iPhone or iPad, notifications work only from the app&rsquo;s Home Screen icon:
          <ol className="mt-1 list-decimal space-y-0.5 pl-5">
            <li>Tap the Share button in Safari, then &ldquo;Add to Home Screen&rdquo;.</li>
            <li>Open Ministry Hub from that new icon.</li>
            <li>Come back to Account Security and turn notifications on.</li>
          </ol>
        </div>
      )}

      {support === "unsupported" && (
        <p className="mt-3 text-sm text-[#777]">This browser can&rsquo;t receive notifications. Try Chrome or Safari on your phone.</p>
      )}

      {support === "ready" && (
        <>
          {!publicKey && <p className="mt-3 text-sm text-[#777]">Notifications aren&rsquo;t set up on this server yet.</p>}
          {permission === "denied" && !on && (
            <p className="mt-3 rounded-md bg-[#fff8e1] px-3 py-2 text-sm text-[#5c4400]">
              Notifications are blocked for this app on this device. Allow them in your phone&rsquo;s settings (Settings &rarr;
              Notifications &rarr; Ministry Hub, or the browser&rsquo;s site settings), then try again.
            </p>
          )}
          {on ? (
            <div className="mt-3 space-y-2">
              <p className="text-sm text-[#333]">
                <span className="mr-2 rounded bg-[#d4edda] px-1.5 py-0.5 text-[11px] font-semibold uppercase text-[#155724]">On</span>
                for this device
              </p>
              <button type="button" onClick={test} disabled={!!busy} className={PRIMARY_BUTTON}>
                <BusyLabel busy={busy === "test"} busyText="Sending…">
                  Send a test
                </BusyLabel>
              </button>
              <button
                type="button"
                onClick={turnOff}
                disabled={!!busy}
                className="w-full rounded-md border border-[#ddd] bg-white py-2.5 text-sm font-semibold text-[#333] hover:bg-[#f5f5f5] disabled:opacity-60"
              >
                <BusyLabel busy={busy === "off"} busyText="Turning off…">
                  Turn off for this device
                </BusyLabel>
              </button>
            </div>
          ) : (
            publicKey && (
              <button type="button" onClick={turnOn} disabled={!!busy} className={`${PRIMARY_BUTTON} mt-4`}>
                <BusyLabel busy={busy === "on"} busyText="Follow the prompt on your device…">
                  Turn on for this device
                </BusyLabel>
              </button>
            )
          )}
        </>
      )}

      {error && <p className="mt-3 rounded-md bg-[#f8d7da] px-3 py-2 text-sm text-[#721c24]">{error}</p>}
      {notice && <p className="mt-3 rounded-md bg-[#d4edda] px-3 py-2 text-sm text-[#155724]">{notice}</p>}
    </div>
  );
}
