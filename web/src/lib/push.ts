import webpush, { type PushSubscription } from "web-push";
import { createClient as createSupabaseClient } from "@supabase/supabase-js";

/** Phone notifications (Web Push, owner-requested 5 Oct 2026, migration
 * 0092). Messages are queued in the database's notification_outbox by
 * triggers; this server sends them to each recipient's devices through
 * Apple's / Google's push services, signed with this app's VAPID key pair:
 * VAPID_PUBLIC_KEY and VAPID_PRIVATE_KEY in Vercel (the private one never
 * leaves the server). Until both are set nothing is sent and messages wait
 * in the outbox. */

const VAPID_SUBJECT = "mailto:no-reply@ministryhub.magnous.ca";

export function vapidPublicKey(): string | null {
  return process.env.VAPID_PUBLIC_KEY?.trim() || null;
}

function configured(): boolean {
  const pub = vapidPublicKey();
  const priv = process.env.VAPID_PRIVATE_KEY?.trim();
  if (!pub || !priv) return false;
  webpush.setVapidDetails(VAPID_SUBJECT, pub, priv);
  return true;
}

export type PushMessage = { title: string; body: string; url: string; tag?: string };
type Device = { endpoint: string; p256dh: string; auth: string };

/** Sends one message to the given devices. Returns which went out and
 * which devices Apple / Google say no longer exist (to be forgotten). */
export async function sendToDevices(devices: Device[], message: PushMessage) {
  const sent: string[] = [];
  const gone: string[] = [];
  let failed = 0;
  if (!configured()) return { sent, gone, failed: devices.length };
  const payload = JSON.stringify(message);
  await Promise.all(
    devices.map(async (d) => {
      const subscription: PushSubscription = { endpoint: d.endpoint, keys: { p256dh: d.p256dh, auth: d.auth } };
      try {
        await webpush.sendNotification(subscription, payload, { TTL: 24 * 60 * 60, urgency: "high" });
        sent.push(d.endpoint);
      } catch (e) {
        const status = (e as { statusCode?: number }).statusCode;
        if (status === 404 || status === 410) gone.push(d.endpoint);
        else failed += 1;
      }
    }),
  );
  return { sent, gone, failed };
}

/** The database as this server alone (the check-in server key, 0080) --
 * nobody signed in: a check-in poster creates pending servants too. */
function serverClient() {
  const key = process.env.CHECKIN_SERVER_KEY;
  return createSupabaseClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY!, {
    db: { schema: process.env.NEXT_PUBLIC_APP_ENV as "qa" | "prod" },
    auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false },
    global: { headers: key ? { "x-checkin-key": key } : {} },
  });
}

/** Sends whatever is waiting in the outbox. Safe to call any number of
 * times, from anywhere: each message is taken by one sender, and a message
 * that fails is offered again a couple of minutes later (five tries). Called
 * right after the actions that queue messages (in `after()`, so the person
 * doesn't wait for it). Never throws. */
export async function dispatchPush(): Promise<void> {
  try {
    if (!configured()) return;
    const supabase = serverClient();
    const { data, error } = await supabase.rpc("push_claim", { p_limit: 20 });
    if (error || !data) return;
    for (const item of data as { outbox_id: number; title: string; body: string; url: string; devices: Device[] }[]) {
      const result = await sendToDevices(item.devices ?? [], { title: item.title, body: item.body, url: item.url, tag: `outbox-${item.outbox_id}` });
      const allFailed = item.devices.length > 0 && result.sent.length === 0 && result.failed > 0;
      await supabase.rpc("push_mark_sent", {
        p_outbox_id: item.outbox_id,
        p_sent_endpoints: result.sent,
        p_gone_endpoints: result.gone,
        p_error: allFailed ? `${result.failed} device(s) failed` : null,
      });
    }
  } catch {
    // Notifications must never break the action that triggered them.
  }
}
