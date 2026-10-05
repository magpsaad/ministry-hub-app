/** Screen lock after idle, unlocked with Face ID / fingerprint (owner-approved
 * 5 Oct 2026, migration 0089). Shared by the front door
 * (src/lib/supabase/proxy.ts), the API routes and the browser, so it imports
 * nothing server-only. */

/** Ministry Settings choices; empty (null) = off. */
export const LOCK_MINUTE_CHOICES = [2, 5, 10, 15, 30] as const;

export const UNLOCK_PATH = "/security/unlock";

/** Reachable while locked: signing in again, the public check-in, the
 * unlock page and its API, the activity report, and photos (fetched in
 * bulk behind the lock screen; a photo link alone shows nothing else). */
export const LOCK_EXEMPT_PREFIXES = [
  "/login",
  "/auth",
  "/checkin",
  UNLOCK_PATH,
  "/api/unlock",
  "/api/screen-lock",
  "/api/photo",
];

/** How often, at most, the browser reports that the person is active. */
export const ACTIVITY_PING_MS = 20_000;

export function isLockExempt(pathname: string): boolean {
  return LOCK_EXEMPT_PREFIXES.some((p) => pathname === p || pathname.startsWith(`${p}/`));
}

/** POST /api/screen-lock */
export type LockStatus = { enabled: boolean; minutes: number | null; locked: boolean };

/** GET /api/unlock/methods */
export type UnlockMethods = { faceId: boolean; authenticator: boolean; name: string | null };
