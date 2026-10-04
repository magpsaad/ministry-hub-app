import { createServerClient } from "@supabase/ssr";
import { NextResponse, type NextRequest } from "next/server";
import { resolveAddress, ministryHeaders } from "@/lib/ministry-context";

/** REQUIREMENTS.md §6.1 addendum -- paths a signed-in-but-not-yet-
 * registered person must still be able to reach: signing in/out, the
 * public anonymous Checkin flow, the OAuth callback, and the registration
 * page itself (redirecting there again would loop). Everything else is
 * gated. */
const GATE_EXEMPT_PREFIXES = ["/login", "/checkin", "/auth", "/register", "/security"];

/** Owner-approved sign-in change B (3 Oct 2026, migration 0079): the
 * authenticator-app step. Reachable before it's done: signing in/out, the
 * public check-in, and the Account Security pages themselves. */
const SECURITY_PREFIX = "/security";
const TWO_STEP_EXEMPT_PREFIXES = ["/login", "/auth", "/checkin", SECURITY_PREFIX];

/** Fetched without a session (a browser checking for an installable PWA, or
 * an app-store-style crawler) -- must never be redirected regardless of
 * auth state. Distinct from GATE_EXEMPT_PREFIXES above, which is about what
 * a signed-in-but-incomplete person can reach, not what an anonymous
 * request can. */
const PUBLIC_ASSET_PATHS = ["/manifest.webmanifest"];

/** MULTI_TENANT_PLAN.md §3.2 -- the two plain status pages. Neither makes a
 * single data call. */
export const NOT_SET_UP_PATH = "/address-not-set-up";
export const INACTIVE_PATH = "/ministry-inactive";

/** §3.8 -- the Church Admin console lives only on its own address. */
const CONSOLE_PREFIX = "/console";

/** What an inactive ministry's address still allows before we know who's
 * asking: signing in (the Church Admin can still get in, §3.2) and the
 * status page itself. Check-in is NOT here -- it stops for everyone. */
const INACTIVE_OPEN_PREFIXES = ["/login", "/auth", INACTIVE_PATH];

function matchesPrefix(pathname: string, prefixes: string[]): boolean {
  return prefixes.some((p) => pathname === p || pathname.startsWith(`${p}/`));
}

/**
 * Refreshes the Supabase auth session on every request and keeps the
 * session cookie in sync between the browser and the server. Called from
 * src/proxy.ts (Next.js 16 renamed middleware.ts -> proxy.ts).
 *
 * Decides, in this order (MULTI_TENANT_PLAN.md §8):
 * 1. Which ministry this address belongs to. Unknown address -> "This
 *    address isn't set up", with no data call of any kind. The console's
 *    address -> only the console (and signing in) is reachable there, and a
 *    ministry's address never serves the console.
 * 2. Inactive ministry -> "This ministry isn't active" for everyone except
 *    the Church Admin (who can still sign in and work there).
 * 3. The signed-out gate, then the registration gate: a signed-in user with
 *    no role IN THIS MINISTRY, or missing phone/gender on THIS MINISTRY's
 *    profile, goes to this ministry's /register. The Church Admin passes
 *    (they act as an Admin of whichever ministry's address they're on,
 *    §3.5) without needing a role grant there.
 *
 * The registration gate lives here (not just at the page level) so it
 * covers every route in one place, including deep links into pages with no
 * check of their own. Read-only by design: the profile-provisioning and
 * approval-linking side effects (ensureProfile(),
 * link_approved_pending_servant()) still only run from Server Components.
 *
 * The signed-out gate is here too, so a signed-out request to a gated page
 * never runs that page at all (every gated page keeps its own
 * `if (!user) redirect("/login")` as a backup).
 */
export async function updateSession(request: NextRequest) {
  let response = NextResponse.next({ request });
  const pathname = request.nextUrl.pathname;

  // Public assets never need a session -- return before any other work.
  // (manifest.ts itself copes with any kind of address.)
  if (PUBLIC_ASSET_PATHS.includes(pathname)) {
    return response;
  }

  const address = await resolveAddress(request.headers.get("host") ?? "");

  if (address.kind === "unknown") {
    return pathname === NOT_SET_UP_PATH
      ? response
      : NextResponse.rewrite(new URL(NOT_SET_UP_PATH, request.url));
  }

  const supabase = createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY!,
    {
      db: { schema: process.env.NEXT_PUBLIC_APP_ENV as "qa" | "prod" },
      global: { headers: ministryHeaders(address) },
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

  // Touches the session so expired tokens get refreshed. getClaims()
  // verifies the sign-in token locally against the project's published
  // signing keys (this project uses asymmetric ES256 keys), instead of
  // getUser()'s network round trip to the Auth server on every single
  // request, prefetch and form submit -- Supabase's recommended check for
  // exactly this spot.
  const { data: claimsData } = await supabase.auth.getClaims();
  const userId = claimsData?.claims?.sub ?? null;
  const aal = (claimsData?.claims as { aal?: string } | undefined)?.aal ?? "aal1";

  // What the front door needs to know about this person, read once and
  // only when it matters (migration 0079's gate_info(): Church Admin, and
  // whether their role here requires the authenticator step -- read
  // regardless of that step, which is what is_church_admin() now needs).
  let gateCheck: Promise<{ church_admin: boolean; mfa_required: boolean }> | null = null;
  const gateInfo = () =>
    (gateCheck ??= userId
      ? Promise.resolve(supabase.rpc("gate_info")).then(({ data }) => {
          const row = (data as { church_admin: boolean; mfa_required: boolean }[] | null)?.[0];
          return { church_admin: row?.church_admin === true, mfa_required: row?.mfa_required === true };
        })
      : Promise.resolve({ church_admin: false, mfa_required: false }));

  /** Sends someone who hasn't done the authenticator step to it: to enter
   * a code if they have one set up, or to set one up if their role needs
   * it (or `alwaysRequired`, the console). Null when they may carry on. */
  const twoStepRedirect = async (alwaysRequired: boolean): Promise<NextResponse | null> => {
    if (!userId || aal === "aal2" || matchesPrefix(pathname, TWO_STEP_EXEMPT_PREFIXES)) return null;
    const next = encodeURIComponent(`${pathname}${request.nextUrl.search}`);
    const { data: level } = await supabase.auth.mfa.getAuthenticatorAssuranceLevel();
    if (level?.nextLevel === "aal2") {
      return NextResponse.redirect(new URL(`${SECURITY_PREFIX}/verify?next=${next}`, request.url));
    }
    if (alwaysRequired || (await gateInfo()).mfa_required) {
      return NextResponse.redirect(new URL(`${SECURITY_PREFIX}/setup?next=${next}`, request.url));
    }
    return null;
  };

  if (address.kind === "console") {
    // Only the console and signing in/out exist on this address. Whether
    // the signed-in person is actually a Church Admin is checked by the
    // console pages themselves (and again by every console function).
    if (!matchesPrefix(pathname, [CONSOLE_PREFIX, "/login", "/auth", SECURITY_PREFIX])) {
      return NextResponse.redirect(new URL(CONSOLE_PREFIX, request.url));
    }
    if (!userId && matchesPrefix(pathname, [CONSOLE_PREFIX, SECURITY_PREFIX])) {
      return NextResponse.redirect(new URL("/login", request.url));
    }
    // The console is Church-Admin-only, and that role always needs the
    // authenticator step.
    return (await twoStepRedirect(true)) ?? response;
  }

  // A ministry's address never serves the console.
  if (matchesPrefix(pathname, [CONSOLE_PREFIX])) {
    return NextResponse.redirect(new URL("/", request.url));
  }

  const isChurchAdmin = async () => (await gateInfo()).church_admin;

  if (!address.isActive && !matchesPrefix(pathname, INACTIVE_OPEN_PREFIXES)) {
    if (!(await isChurchAdmin())) {
      return NextResponse.rewrite(new URL(INACTIVE_PATH, request.url));
    }
    // The Church Admin carries on through the normal gate below.
  }

  // Account Security is exempt from the registration gate below, but not
  // from this one.
  if (!userId && (!matchesPrefix(pathname, GATE_EXEMPT_PREFIXES) || matchesPrefix(pathname, [SECURITY_PREFIX]))) {
    return NextResponse.redirect(new URL("/login", request.url));
  }

  const twoStep = await twoStepRedirect(false);
  if (twoStep) return twoStep;

  if (userId && !matchesPrefix(pathname, GATE_EXEMPT_PREFIXES)) {
    const [{ data: profile }, { count: roleCount }, churchAdmin] = await Promise.all([
      supabase.from("profiles").select("phone, gender").eq("id", userId).maybeSingle(),
      supabase.from("user_roles").select("id", { count: "exact", head: true }).eq("user_id", userId),
      isChurchAdmin(),
    ]);
    const isComplete = !!profile && !!profile.phone && !!profile.gender && (roleCount ?? 0) > 0;
    if (!isComplete && !churchAdmin) {
      return NextResponse.redirect(new URL("/register", request.url));
    }
  }

  return response;
}
