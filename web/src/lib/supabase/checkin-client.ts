import { createClient as createSupabaseClient } from "@supabase/supabase-js";
import { getAddressContext, ministryHeaders } from "@/lib/ministry-context";

/** Security audit #2 (owner-approved, 4 Oct 2026; migration 0080): the
 * public check-in page talks to the database ONLY through this client,
 * on the server. It carries the app server's private key
 * (CHECKIN_SERVER_KEY, set in Vercel and never sent to a browser) in the
 * x-checkin-key header; once the database holds that key's fingerprint
 * (checkin_guard), every check-in function refuses a request without it --
 * so nobody can call them directly with the public key, around the page and
 * its bot check. Never signed in as anyone: check-in is the same for
 * everybody. */
export async function createCheckinClient() {
  const ctx = await getAddressContext();
  if (ctx.kind === "unknown") {
    throw new Error("This address isn't set up for any ministry.");
  }
  const key = process.env.CHECKIN_SERVER_KEY;
  return createSupabaseClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY!, {
    db: { schema: process.env.NEXT_PUBLIC_APP_ENV as "qa" | "prod" },
    auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false },
    global: { headers: { ...ministryHeaders(ctx), ...(key ? { "x-checkin-key": key } : {}) } },
  });
}
