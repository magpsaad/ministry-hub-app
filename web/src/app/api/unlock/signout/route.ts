import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";

/** "Sign in again with an email code" from the lock screen: ends this
 * sign-in (this device only); the browser then goes to the sign-in page. */
export async function POST() {
  const supabase = await createClient();
  await supabase.auth.signOut({ scope: "local" });
  return NextResponse.json({ ok: true });
}
