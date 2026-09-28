import { createServerClient } from "@supabase/ssr";
import { NextResponse, type NextRequest } from "next/server";

/** REQUIREMENTS.md §6.1 addendum -- paths a signed-in-but-not-yet-
 * registered person must still be able to reach: signing in/out, the
 * public anonymous Checkin flow, the OAuth callback, and the registration
 * page itself (redirecting there again would loop). Everything else is
 * gated. */
const GATE_EXEMPT_PREFIXES = ["/login", "/checkin", "/auth", "/register"];

/** Fetched without a session (a browser checking for an installable PWA, or
 * an app-store-style crawler) -- must never be redirected regardless of
 * auth state. Distinct from GATE_EXEMPT_PREFIXES above, which is about what
 * a signed-in-but-incomplete person can reach, not what an anonymous
 * request can. */
const PUBLIC_ASSET_PATHS = ["/manifest.webmanifest"];

function isGateExempt(pathname: string): boolean {
  return GATE_EXEMPT_PREFIXES.some((p) => pathname === p || pathname.startsWith(`${p}/`));
}

/**
 * Refreshes the Supabase auth session on every request and keeps the
 * session cookie in sync between the browser and the server. Called from
 * src/proxy.ts (Next.js 16 renamed middleware.ts -> proxy.ts).
 *
 * Also enforces the registration gate here (not just at the page level):
 * a signed-in user with no role, or with a role but missing mandatory
 * profile fields (phone/gender), gets redirected to /register regardless
 * of which page they tried to reach -- a page-level check alone would only
 * catch someone who lands on a page that happens to have one; this covers
 * every route in one place, including a deep link into a page that has no
 * such check at all (owner-reported gap: QR Codes and the Service Calendar
 * currently have none). Read-only, lightweight (one query) -- the actual
 * profile-provisioning/approval-linking side effects (ensureProfile(),
 * link_approved_pending_servant()) still only run from Server Components
 * (the /register page itself, and the normal landing page), not here --
 * this function's own Supabase client is scoped to request/response
 * cookies, not the cookies() API those rely on, so it stays read-only by
 * design rather than risk running that logic in a different context.
 *
 * Also enforces the signed-out gate here, not just at the page level.
 * Every gated page already has its own `if (!user) redirect("/login")` --
 * that isn't removed, it's now a backup -- but a signed-out request used to
 * reach the page first regardless, so an anonymous direct hit to e.g.
 * /g/[groupId]/members would let that page's own data query fire (and fail
 * loudly with a Postgres "permission denied", RLS correctly blocking it,
 * but noisy in the server logs) before the page's own redirect won out.
 * Redirecting here instead means the page never runs at all for a
 * signed-out request to a gated route.
 */
export async function updateSession(request: NextRequest) {
  let response = NextResponse.next({ request });

  const supabase = createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY!,
    {
      db: { schema: process.env.NEXT_PUBLIC_APP_ENV as "qa" | "prod" },
      cookies: {
        getAll() {
          return request.cookies.getAll();
        },
        setAll(cookiesToSet) {
          cookiesToSet.forEach(({ name, value }) =>
            request.cookies.set(name, value),
          );
          response = NextResponse.next({ request });
          cookiesToSet.forEach(({ name, value, options }) =>
            response.cookies.set(name, value, options),
          );
        },
      },
    },
  );

  // Public assets never need a session -- return before any auth work
  // (this check used to run after the auth call, so every manifest fetch
  // paid for a round trip it didn't use).
  const pathname = request.nextUrl.pathname;
  if (PUBLIC_ASSET_PATHS.includes(pathname)) {
    return response;
  }

  // Touches the session so expired tokens get refreshed. getClaims()
  // verifies the sign-in token locally against the project's published
  // signing keys (this project uses asymmetric ES256 keys), instead of
  // getUser()'s network round trip to the Auth server on every single
  // request, prefetch and form submit -- Supabase's recommended check for
  // exactly this spot.
  const { data: claimsData } = await supabase.auth.getClaims();
  const userId = claimsData?.claims?.sub ?? null;

  if (!userId && !isGateExempt(pathname)) {
    return NextResponse.redirect(new URL("/login", request.url));
  }

  if (userId && !isGateExempt(pathname)) {
    const [{ data: profile }, { count: roleCount }] = await Promise.all([
      supabase.from("profiles").select("phone, gender").eq("id", userId).maybeSingle(),
      supabase.from("user_roles").select("id", { count: "exact", head: true }).eq("user_id", userId),
    ]);
    const isComplete = !!profile && !!profile.phone && !!profile.gender && (roleCount ?? 0) > 0;
    if (!isComplete) {
      return NextResponse.redirect(new URL("/register", request.url));
    }
  }

  return response;
}
