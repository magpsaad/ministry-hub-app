"use server";

import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import { sendToDevices, vapidPublicKey } from "@/lib/push";
import { getAddressContext } from "@/lib/ministry-context";

/** My Settings -> Notifications (migrations 0092-0094): this device on or
 * off, a test, the one-time prompt, and which kinds I want. */

/** Phone notifications (migration 0092): this device's push "address" and
 * keys, from the browser, saved for me on this ministry's address. */
export async function savePushSubscription(
  sub: { endpoint?: string; keys?: { p256dh?: string; auth?: string } },
  label: string,
): Promise<{ error: string | null }> {
  const endpoint = sub.endpoint ?? "";
  const p256dh = sub.keys?.p256dh ?? "";
  const auth = sub.keys?.auth ?? "";
  if (!endpoint.startsWith("https://") || !p256dh || !auth) return { error: "This device didn't give a usable notification address." };
  const supabase = await createClient();
  const { error } = await supabase.rpc("save_push_subscription", {
    p_endpoint: endpoint,
    p_p256dh: p256dh,
    p_auth: auth,
    p_label: label.replace(/[^\p{L}\p{N} .,'()-]/gu, "").slice(0, 40) || null,
  });
  if (error) return { error: error.message.includes("Too many") ? error.message : "Couldn't turn notifications on. Please try again." };
  revalidatePath("/settings/notifications");
  return { error: null };
}

export async function removePushSubscription(endpoint: string): Promise<{ error: string | null }> {
  const supabase = await createClient();
  const { error } = await supabase.rpc("remove_push_subscription", { p_endpoint: endpoint });
  if (error) return { error: "Couldn't turn notifications off. Please try again." };
  revalidatePath("/settings/notifications");
  return { error: null };
}

/** The one-time "turn on notifications" prompt: only for someone signed in
 * on a ministry's address, once the server has its notification keys. */
export async function getPushPromptContext(): Promise<{ ask: boolean; publicKey: string | null }> {
  const publicKey = vapidPublicKey();
  const [supabase, ctx] = await Promise.all([createClient(), getAddressContext()]);
  if (!publicKey || ctx.kind !== "ministry" || !ctx.isActive) return { ask: false, publicKey: null };
  const { data } = await supabase.auth.getUser();
  return { ask: !!data.user, publicKey };
}

/** "Send me a test": to my own devices on this address. */
export async function sendTestNotification(): Promise<{ error: string | null; sent: number }> {
  const [supabase, ctx] = await Promise.all([createClient(), getAddressContext()]);
  if (ctx.kind !== "ministry") return { error: "Notifications are set up on a ministry's address.", sent: 0 };
  const { data: devices } = await supabase
    .from("push_subscriptions")
    .select("endpoint, p256dh, auth")
    .eq("ministry_id", ctx.ministryId);
  if (!devices?.length) return { error: "Notifications aren't on for any of your devices here yet.", sent: 0 };
  const result = await sendToDevices(devices as { endpoint: string; p256dh: string; auth: string }[], {
    title: "Ministry Hub",
    body: "Test notification: notifications are working on this device.",
    url: "/settings/notifications",
    tag: "test",
  });
  if (result.sent.length === 0) return { error: "The test couldn't be sent. Try turning notifications off and on again.", sent: 0 };
  return { error: null, sent: result.sent.length };
}

/** The weekly recap's day (0 = Sunday) and hour, for me here (0095). */
export async function setNotificationSchedule(event: string, day: number, hour: number): Promise<{ error: string | null }> {
  const supabase = await createClient();
  const { error } = await supabase.rpc("set_notification_schedule", { p_event: event, p_day: day, p_hour: hour });
  if (error) return { error: "Couldn't save that. Please try again." };
  revalidatePath("/settings/notifications");
  return { error: null };
}

/** One kind of notification on or off for me, on this ministry (0094). */
export async function setNotificationPreference(event: string, enabled: boolean): Promise<{ error: string | null }> {
  const supabase = await createClient();
  const { error } = await supabase.rpc("set_notification_preference", { p_event: event, p_enabled: enabled });
  if (error) return { error: "Couldn't save that. Please try again." };
  revalidatePath("/settings/notifications");
  return { error: null };
}
