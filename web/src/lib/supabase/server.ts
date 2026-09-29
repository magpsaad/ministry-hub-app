import { createServerClient } from "@supabase/ssr";
import { cookies } from "next/headers";
import { getAddressContext, ministryHeaders } from "@/lib/ministry-context";

/**
 * Supabase client for use in Server Components, Route Handlers, and Server Actions.
 * Reads/writes the auth session via Next.js cookies.
 *
 * Targets the `qa` or `prod` Postgres schema per NEXT_PUBLIC_APP_ENV (REQUIREMENTS.md
 * §1.1 -- one Supabase project, two schemas). Without this, PostgREST defaults to
 * `public`, where none of our tables live.
 *
 * Every call carries this address's ministry code (`x-ministry-id`,
 * MULTI_TENANT_PLAN.md §3.2), so every read and write lands in that one
 * ministry. On an address nobody set up it refuses to make a client at all
 * (fail closed) -- the proxy gate normally stops such a request first.
 */
export async function createClient() {
  const [cookieStore, ctx] = await Promise.all([cookies(), getAddressContext()]);
  if (ctx.kind === "unknown") {
    throw new Error("This address isn't set up for any ministry.");
  }

  return createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY!,
    {
      db: { schema: process.env.NEXT_PUBLIC_APP_ENV as "qa" | "prod" },
      global: { headers: ministryHeaders(ctx) },
      cookies: {
        getAll() {
          return cookieStore.getAll();
        },
        setAll(cookiesToSet) {
          try {
            cookiesToSet.forEach(({ name, value, options }) =>
              cookieStore.set(name, value, options),
            );
          } catch {
            // setAll called from a Server Component; safe to ignore
            // when middleware is refreshing the session.
          }
        },
      },
    },
  );
}
