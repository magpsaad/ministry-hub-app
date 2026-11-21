/** Where the owner finishes a new ministry's setup outside the app.
 *
 * Vercel's dashboard has no short link to a project's Domains page, so the
 * exact address is built from the team's URL name and the project name. If
 * Vercel's team name ever changes, correct VERCEL_TEAM here -- it is the part
 * of the dashboard address right after vercel.com/. The project names are the
 * Vercel projects "ministry-hub-prod" and "ministry-hub-qa". */
const VERCEL_TEAM = "ministryhub";

export function vercelDomainsUrl(environment: "QA" | "production"): string {
  const project = environment === "production" ? "ministry-hub-prod" : "ministry-hub-qa";
  return `https://vercel.com/${VERCEL_TEAM}/${project}/settings/domains`;
}

/** The exact Redirect URL Supabase needs for one ministry address. The app
 * sends Google sign-in back to `<address>/auth/callback` (login/actions.ts),
 * and Supabase only returns people to an address on its list. */
export function supabaseRedirectUrl(host: string): string {
  const local = host.startsWith("localhost") || host.startsWith("127.0.0.1");
  return `${local ? "http" : "https"}://${host}/auth/callback`;
}
