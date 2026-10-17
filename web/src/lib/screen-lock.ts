/** Screen lock after idle, unlocked with Face ID / fingerprint (owner-approved
 * 5 Oct 2026, migration 0089). Shared by the front door
 * (src/lib/supabase/proxy.ts), the API routes and the browser, so it imports
 * nothing server-only. */

/** Owner-requested (17 Oct 2026, free hosting allowance): the screen lock is
 * paused for every ministry. While false, nothing asks whether a sign-in is
 * locked (the front door, the browser) and Ministry Settings can't turn it
 * on. Everything else is kept: set this back to true to bring it back. */
export const SCREEN_LOCK_AVAILABLE = false;

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
