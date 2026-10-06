"use client";

import { useEffect, useState } from "react";
import { savePushSubscription, removePushSubscription } from "@/app/security/actions";
import { deviceLabel, isAppleMobile, isInstalledApp } from "@/lib/device-label";

/** Phone notifications (migration 0092): what this device can do and the
 * turn on / off steps, shared by the onboarding card, the one-time prompt and
 * Account Security, so all three behave the same. */

export type PushSupport = "checking" | "unsupported" | "needs-home-screen" | "ready";

function keyBytes(base64url: string): Uint8Array<ArrayBuffer> {
  const padded = (base64url + "=".repeat((4 - (base64url.length % 4)) % 4)).replace(/-/g, "+").replace(/_/g, "/");
  const raw = atob(padded);
  const out = new Uint8Array(new ArrayBuffer(raw.length));
  for (let i = 0; i < raw.length; i++) out[i] = raw.charCodeAt(i);
  return out;
}

export function pushCapable(): boolean {
  return "serviceWorker" in navigator && "PushManager" in window && "Notification" in window;
}

/** This device's push subscription on this address, if any. */
export async function currentSubscription(): Promise<PushSubscription | null> {
  if (!pushCapable()) return null;
  const reg = await navigator.serviceWorker.getRegistration().catch(() => undefined);
  return (await reg?.pushManager.getSubscription().catch(() => null)) ?? null;
}

export function isAndroid(): boolean {
  return /Android/.test(navigator.userAgent);
}

export function usePushSetup(publicKey: string | null) {
  const [support, setSupport] = useState<PushSupport>("checking");
  const [permission, setPermission] = useState<NotificationPermission | "unsupported">("default");
  const [endpoint, setEndpoint] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      const capable = pushCapable();
      const sub = capable ? await currentSubscription() : null;
      if (cancelled) return;
      // An iPhone or iPad in a Safari tab has no notifications at all: they
      // only exist in the app opened from its Home Screen icon.
      setSupport(capable ? "ready" : isAppleMobile() && !isInstalledApp() ? "needs-home-screen" : "unsupported");
      setPermission(capable ? Notification.permission : "unsupported");
      setEndpoint(sub?.endpoint ?? null);
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  /** Asks the device for permission (straight from the tap -- iPhones
   * require that), subscribes and saves it for this person on this
   * ministry's address. Throws a readable error. */
  async function turnOn(): Promise<void> {
    if (!publicKey) throw new Error("Notifications aren't set up on this server yet.");
    const answer = await Notification.requestPermission();
    setPermission(answer);
    if (answer !== "granted") throw new Error("Notifications weren't allowed for this app.");
    const reg = await navigator.serviceWorker.register("/sw.js");
    await navigator.serviceWorker.ready;
    const sub =
      (await reg.pushManager.getSubscription()) ??
      (await reg.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: keyBytes(publicKey) }));
    const res = await savePushSubscription(sub.toJSON(), deviceLabel());
    if (res.error) throw new Error(res.error);
    setEndpoint(sub.endpoint);
  }

  async function turnOff(): Promise<void> {
    const sub = await currentSubscription();
    if (sub) {
      const res = await removePushSubscription(sub.endpoint);
      if (res.error) throw new Error(res.error);
      await sub.unsubscribe();
    }
    setEndpoint(null);
  }

  return { support, permission, endpoint, turnOn, turnOff };
}
