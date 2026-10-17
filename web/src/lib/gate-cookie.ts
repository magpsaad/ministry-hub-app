/** Owner-approved (17 Oct 2026, free hosting allowance): the front door
 * (src/lib/supabase/proxy.ts) asks the database its questions -- Church
 * Admin? authenticator step needed? agreement signed? registration
 * complete? -- once per sign-in per day, not on every page open. When all
 * the answers let someone in, it seals them in this cookie; until it
 * expires (a day), page opens read the cookie instead.
 *
 * The seal is an HMAC with a key derived from the server's own
 * CHECKIN_SERVER_KEY (never sent to a browser), so the cookie can't be
 * made up or edited. It's tied to the person, the ministry, the sign-in
 * session and its authenticator level: signing in again, or finishing the
 * authenticator step, asks afresh. Only a good result is ever sealed --
 * anyone still to sign or register is asked on every page, as before.
 * Without the server key (e.g. a local copy) nothing is sealed. */

export const GATE_COOKIE = "mh_gate";
const VALID_MS = 24 * 60 * 60 * 1000;

export type GateFacts = { churchAdmin: boolean; mfaRequired: boolean };

type Payload = { u: string; m: string; s: string; a: string; e: number; ca: boolean; mr: boolean };

let keyPromise: Promise<CryptoKey> | null = null;
function sealKey(): Promise<CryptoKey> | null {
  const secret = process.env.CHECKIN_SERVER_KEY;
  if (!secret) return null;
  keyPromise ??= crypto.subtle.importKey(
    "raw",
    new TextEncoder().encode(`${secret}|front-door-gate-v1`),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign", "verify"],
  );
  return keyPromise;
}

function toB64Url(bytes: Uint8Array): string {
  let s = "";
  for (const b of bytes) s += String.fromCharCode(b);
  return btoa(s).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

function fromB64Url(text: string): Uint8Array<ArrayBuffer> {
  const b64 = text.replace(/-/g, "+").replace(/_/g, "/") + "===".slice((text.length + 3) % 4);
  const raw = atob(b64);
  const out = new Uint8Array(raw.length);
  for (let i = 0; i < raw.length; i++) out[i] = raw.charCodeAt(i);
  return out;
}

export type GateWho = { userId: string; ministryId: string; sessionId: string; aal: string };

/** A sealed note for this person, good for a day. */
export async function sealGate(who: GateWho, facts: GateFacts): Promise<string | null> {
  const key = sealKey();
  if (!key || !who.sessionId) return null;
  const payload: Payload = {
    u: who.userId,
    m: who.ministryId,
    s: who.sessionId,
    a: who.aal,
    e: Date.now() + VALID_MS,
    ca: facts.churchAdmin,
    mr: facts.mfaRequired,
  };
  const body = new TextEncoder().encode(JSON.stringify(payload));
  const sig = new Uint8Array(await crypto.subtle.sign("HMAC", await key, body));
  return `${toB64Url(body)}.${toB64Url(sig)}`;
}

/** The facts from a genuine, unexpired note for this same person, ministry,
 * sign-in and authenticator level -- otherwise null (ask the database). */
export async function readGate(cookie: string | undefined, who: GateWho): Promise<GateFacts | null> {
  const key = sealKey();
  if (!key || !cookie || !who.sessionId) return null;
  const [bodyText, sigText] = cookie.split(".");
  if (!bodyText || !sigText) return null;
  try {
    const body = fromB64Url(bodyText);
    const ok = await crypto.subtle.verify("HMAC", await key, fromB64Url(sigText), body);
    if (!ok) return null;
    const p = JSON.parse(new TextDecoder().decode(body)) as Payload;
    if (p.u !== who.userId || p.m !== who.ministryId || p.s !== who.sessionId || p.a !== who.aal) return null;
    if (typeof p.e !== "number" || p.e < Date.now()) return null;
    return { churchAdmin: p.ca === true, mfaRequired: p.mr === true };
  } catch {
    return null;
  }
}
