import { createHmac, timingSafeEqual } from "node:crypto";
import { cookies, headers } from "next/headers";
import { createServerClient } from "@supabase/ssr";
import { getAddressContext, ministryHeaders } from "@/lib/ministry-context";

/** Server side of the screen lock and Face ID unlock (migration 0089). */

/** The address this request came in on, as WebAuthn needs it. Every
 * ministry's address is its own "relying party": they're all on vercel.app,
 * which browsers treat like a public domain, so a passkey made on one
 * address can't be used on another. */
export async function relyingParty(): Promise<{ rpID: string; origin: string }> {
  const h = await headers();
  const host = (h.get("x-forwarded-host") ?? h.get("host") ?? "").split(",")[0].trim().toLowerCase();
  const rpID = host.replace(/:\d+$/, "");
  const local = rpID === "localhost" || rpID === "127.0.0.1";
  return { rpID, origin: `${local ? "http" : "https"}://${host}` };
}

/** The signed-in person's own session, plus this server's private key
 * (CHECKIN_SERVER_KEY, never sent to a browser) -- the only way the
 * database will unlock a sign-in or add a Face ID device (0089's
 * app_server_check). Used only after this server has checked Face ID or an
 * authenticator code itself. */
export async function createServerKeyClient() {
  const [cookieStore, ctx] = await Promise.all([cookies(), getAddressContext()]);
  if (ctx.kind === "unknown") {
    throw new Error("This address isn't set up for any ministry.");
  }
  const key = process.env.CHECKIN_SERVER_KEY;
  return createServerClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY!, {
    db: { schema: process.env.NEXT_PUBLIC_APP_ENV as "qa" | "prod" },
    global: { headers: { ...ministryHeaders(ctx), ...(key ? { "x-checkin-key": key } : {}) } },
    cookies: {
      getAll() {
        return cookieStore.getAll();
      },
      setAll(cookiesToSet) {
        try {
          cookiesToSet.forEach(({ name, value, options }) => cookieStore.set(name, value, options));
        } catch {
          // Only reachable from a Server Component; route handlers can set cookies.
        }
      },
    },
  });
}

/** WebAuthn's one-time challenge, kept between "start" and "check" in a
 * short-lived cookie the browser can't read or forge (signed with the
 * server key), tied to the person and to what it's for. */
const CHALLENGE_COOKIE = "mh_unlock_challenge";
const CHALLENGE_SECONDS = 5 * 60;
type Purpose = "register" | "unlock";

function sign(payload: string): string {
  const key = process.env.CHECKIN_SERVER_KEY;
  if (!key) throw new Error("Face ID unlock isn't set up on this server.");
  return createHmac("sha256", key).update(`unlock-challenge:${payload}`).digest("base64url");
}

export async function saveChallenge(purpose: Purpose, userId: string, challenge: string) {
  const exp = Math.floor(Date.now() / 1000) + CHALLENGE_SECONDS;
  const payload = Buffer.from(JSON.stringify({ p: purpose, u: userId, c: challenge, e: exp })).toString("base64url");
  (await cookies()).set(CHALLENGE_COOKIE, `${payload}.${sign(payload)}`, {
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "strict",
    path: "/",
    maxAge: CHALLENGE_SECONDS,
  });
}

/** The saved challenge, used once: it's cleared whatever happens next. */
export async function takeChallenge(purpose: Purpose, userId: string): Promise<string | null> {
  const store = await cookies();
  const value = store.get(CHALLENGE_COOKIE)?.value;
  store.delete(CHALLENGE_COOKIE);
  if (!value) return null;
  const [payload, sig] = value.split(".");
  if (!payload || !sig) return null;
  const expected = Buffer.from(sign(payload));
  const given = Buffer.from(sig);
  if (expected.length !== given.length || !timingSafeEqual(expected, given)) return null;
  try {
    const data = JSON.parse(Buffer.from(payload, "base64url").toString()) as { p: string; u: string; c: string; e: number };
    if (data.p !== purpose || data.u !== userId || data.e * 1000 < Date.now()) return null;
    return data.c;
  } catch {
    return null;
  }
}

export function toBase64Url(bytes: Uint8Array): string {
  return Buffer.from(bytes).toString("base64url");
}

export function fromBase64Url(text: string): Uint8Array<ArrayBuffer> {
  const buf = Buffer.from(text, "base64url");
  const out = new Uint8Array(new ArrayBuffer(buf.length));
  out.set(buf);
  return out;
}

/** A short, plain name for the device, from what the browser sent. */
export function cleanLabel(raw: unknown): string {
  return String(raw ?? "")
    .replace(/[^\p{L}\p{N} .,'()-]/gu, "")
    .trim()
    .slice(0, 40);
}
