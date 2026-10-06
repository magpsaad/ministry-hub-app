import { NextResponse } from "next/server";
import { dispatchPush } from "@/lib/push";

/** Phone notifications (migration 0095): the database's every-5-minutes job
 * (pg_cron) queues what's due and then calls this to have it sent. Open to
 * anyone on purpose -- all it can do is send messages that are already due,
 * to the people they're for -- and at most every 10 seconds per server
 * instance. */
const MIN_GAP_MS = 10_000;
let last = 0;

async function tick() {
  if (Date.now() - last > MIN_GAP_MS) {
    last = Date.now();
    await dispatchPush();
  }
  return NextResponse.json({ ok: true }, { headers: { "Cache-Control": "no-store" } });
}

export const GET = tick;
export const POST = tick;
