import { after, NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import type { LockStatus } from "@/lib/screen-lock";
import { dispatchPush } from "@/lib/push";

// Catch-up for phone notifications (0092): a message that couldn't go out
// when it was created is sent the next time anyone uses the app. At most
// every 30 seconds per server instance.
const CATCH_UP_MS = 30_000;
let lastCatchUp = 0;

/** Screen lock (migration 0089): the browser reports that the person is
 * active (at most every 20 seconds, only while they tap or type) and learns
 * this address's lock setting and whether this sign-in is already locked.
 * Reporting activity never unlocks a locked sign-in. */
export async function POST() {
  const supabase = await createClient();
  const { data } = await supabase.rpc("screen_lock_state", { p_touch: true });
  const row = (data as { lock_minutes: number | null; locked: boolean }[] | null)?.[0];
  if (Date.now() - lastCatchUp > CATCH_UP_MS) {
    lastCatchUp = Date.now();
    after(dispatchPush);
  }
  const status: LockStatus = { enabled: !!row?.lock_minutes, minutes: row?.lock_minutes ?? null, locked: !!row?.locked };
  return NextResponse.json(status, { headers: { "Cache-Control": "no-store" } });
}
