"use client";

import { useEffect, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { browserSupportsWebAuthn, platformAuthenticatorIsAvailable, startRegistration } from "@simplewebauthn/browser";
import { removeUnlockDevice } from "./actions";
import { CARD, PRIMARY_BUTTON } from "./shared";
import { deviceLabel } from "@/lib/device-label";
import { useTimezone } from "@/components/TimezoneProvider";
import { formatDateTimeInZone } from "@/lib/timezone";

export type UnlockDeviceRow = { id: string; label: string | null; created_at: string; last_used_at: string | null };



/** Account Security -> Face ID / fingerprint unlock (migration 0089): turn
 * it on for this device, see and remove the devices set up for this
 * address. The face or fingerprint never leaves the device; only its
 * public key is kept. */
export function FaceIdCard({ devices, lockMinutes }: { devices: UnlockDeviceRow[]; lockMinutes: number | null }) {
  const router = useRouter();
  const timeZone = useTimezone();
  const day = (iso: string) => formatDateTimeInZone(iso, timeZone, { year: "numeric", month: "short", day: "numeric" });
  const [supported, setSupported] = useState<boolean | null>(null);
  const [busy, setBusy] = useState(false);
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      const ok = browserSupportsWebAuthn() && (await platformAuthenticatorIsAvailable().catch(() => false));
      if (!cancelled) setSupported(ok);
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  async function turnOn() {
    setBusy(true);
    setError(null);
    setNotice(null);
    try {
      const start = await fetch("/api/unlock-devices/options", { method: "POST" });
      if (!start.ok) throw new Error(((await start.json().catch(() => null)) as { error?: string } | null)?.error);
      const response = await startRegistration({ optionsJSON: await start.json() });
      const save = await fetch("/api/unlock-devices/verify", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ response, label: deviceLabel() }),
      });
      if (!save.ok) throw new Error(((await save.json().catch(() => null)) as { error?: string } | null)?.error);
      try {
        localStorage.setItem("mh_faceid_offer", "done");
      } catch {
        // Private browsing.
      }
      setNotice("Done. When the app locks on this device, unlock it with Face ID or your fingerprint.");
      router.refresh();
    } catch (e) {
      const name = (e as { name?: string })?.name;
      setError(
        name === "InvalidStateError"
          ? "This device is already set up."
          : name === "NotAllowedError" || name === "AbortError"
            ? "It was cancelled. Try again when you're ready."
            : (e as Error)?.message || "Couldn't turn it on. Please try again.",
      );
    } finally {
      setBusy(false);
    }
  }

  function remove(id: string) {
    if (!confirm("Remove Face ID / fingerprint unlock from this device?")) return;
    setError(null);
    setNotice(null);
    startTransition(async () => {
      const res = await removeUnlockDevice(id);
      if (res.error) setError(res.error);
      else router.refresh();
    });
  }

  return (
    <div id="face-id" className={CARD}>
      <h2 className="text-base font-bold text-[#333]">Face ID / fingerprint unlock</h2>
      <p className="mt-1 text-sm text-[#555]">
        {lockMinutes
          ? `This ministry locks the app after ${lockMinutes} minutes without use. `
          : "If your ministry turns on the screen lock, "}
        Unlock it with Face ID, your fingerprint or your device&rsquo;s PIN instead of waiting for an email code. Your face
        or fingerprint never leaves your device.
      </p>

      {devices.length > 0 && (
        <ul className="mt-3 divide-y divide-[#f0f0f0]">
          {devices.map((d) => (
            <li key={d.id} className="flex items-center justify-between gap-3 py-2 text-sm">
              <span className="text-[#333]">
                <span className="mr-2 rounded bg-[#d4edda] px-1.5 py-0.5 text-[11px] font-semibold uppercase text-[#155724]">On</span>
                {d.label ?? "Device"} &middot; added {day(d.created_at)}
                {d.last_used_at ? `, last used ${day(d.last_used_at)}` : ""}
              </span>
              <button
                type="button"
                onClick={() => remove(d.id)}
                disabled={pending}
                className="shrink-0 text-xs font-semibold text-[#dc3545] hover:underline disabled:opacity-60"
              >
                Remove
              </button>
            </li>
          ))}
        </ul>
      )}

      {error && <p className="mt-3 rounded-md bg-[#f8d7da] px-3 py-2 text-sm text-[#721c24]">{error}</p>}
      {notice && <p className="mt-3 rounded-md bg-[#d4edda] px-3 py-2 text-sm text-[#155724]">{notice}</p>}

      {supported === false ? (
        <p className="mt-3 text-sm text-[#777]">
          This device or browser doesn&rsquo;t offer Face ID, a fingerprint or Windows Hello. You can still unlock with an email
          code{devices.length ? ", or on your other devices" : ""}.
        </p>
      ) : (
        <button type="button" onClick={turnOn} disabled={busy || supported === null} className={`${PRIMARY_BUTTON} mt-4`}>
          {busy ? "Follow the prompt on your device…" : devices.length ? "Turn it on for this device too" : "Turn it on for this device"}
        </button>
      )}
    </div>
  );
}
