import { createHmac, timingSafeEqual } from "node:crypto";
import { cookies, headers } from "next/headers";

/** Security audit #2 (owner-approved, 4 Oct 2026): a visitor to a check-in
 * poster passes the Cloudflare bot check once; this server checks the
 * answer with Cloudflare and gives that browser a signed pass for that
 * poster, good for 12 hours (a service night). Every check-in action needs
 * the pass. Signed with the server's private CHECKIN_SERVER_KEY, so it
 * can't be made up; checked with TURNSTILE_SECRET_KEY (both only in
 * Vercel). Until both are set, the check is skipped -- the page works as
 * before. */
const PASS_COOKIE = "mh_checkin_pass";
const PASS_SECONDS = 12 * 60 * 60;

function serverKey(): string | null {
  return process.env.CHECKIN_SERVER_KEY || null;
}

export function botCheckEnabled(): boolean {
  return Boolean(serverKey() && process.env.TURNSTILE_SECRET_KEY);
}

function sign(payload: string): string {
  return createHmac("sha256", serverKey()!).update(payload).digest("base64url");
}

export async function hasCheckinPass(posterToken: string): Promise<boolean> {
  if (!botCheckEnabled()) return true;
  const value = (await cookies()).get(PASS_COOKIE)?.value;
  if (!value) return false;
  const [token, exp, sig] = value.split(".");
  if (token !== posterToken || !exp || !sig) return false;
  if (Number(exp) * 1000 < Date.now()) return false;
  const expected = Buffer.from(sign(`${token}.${exp}`));
  const given = Buffer.from(sig);
  return expected.length === given.length && timingSafeEqual(expected, given);
}

/** Checks the bot-check answer with Cloudflare and, if it passes, gives
 * this browser the pass for this poster. */
export async function grantCheckinPass(posterToken: string, turnstileToken: string): Promise<boolean> {
  if (!botCheckEnabled()) return true;
  if (!/^[0-9a-f-]{36}$/i.test(posterToken) || !turnstileToken || turnstileToken.length > 4096) return false;

  const ip = (await headers()).get("x-forwarded-for")?.split(",")[0]?.trim();
  const body = new URLSearchParams({ secret: process.env.TURNSTILE_SECRET_KEY!, response: turnstileToken });
  if (ip) body.set("remoteip", ip);
  let success = false;
  try {
    const res = await fetch("https://challenges.cloudflare.com/turnstile/v0/siteverify", { method: "POST", body });
    success = Boolean(((await res.json()) as { success?: boolean }).success);
  } catch {
    success = false;
  }
  if (!success) return false;

  const exp = Math.floor(Date.now() / 1000) + PASS_SECONDS;
  (await cookies()).set(PASS_COOKIE, `${posterToken}.${exp}.${sign(`${posterToken}.${exp}`)}`, {
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "lax",
    path: "/",
    maxAge: PASS_SECONDS,
  });
  return true;
}
