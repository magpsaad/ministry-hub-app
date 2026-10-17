/** Owner-requested (17 Oct 2026, migration 0121): ministries must never
 * learn about each other. Someone who serves (or has registered) in another
 * ministry and has nothing on THIS ministry's address -- a failed sign-in
 * landed them here, a wrong link, an old bookmark -- sees this plain page
 * instead of this ministry's registration form. It names no other ministry.
 * Registering here anyway takes a deliberate "I want to join" (JOIN_PARAM). */
export const NO_ACCESS_PATH = "/no-access";
export const JOIN_PARAM = "join";

export type AccessHere = { roleHere: boolean; pendingHere: boolean; elsewhere: boolean };

/** Reads my_access_here()'s answer: the signed-in person's own standing on
 * this address. */
export function parseAccess(data: unknown): AccessHere {
  const row = (data as { role_here: boolean; pending_here: boolean; elsewhere: boolean }[] | null)?.[0];
  return {
    roleHere: row?.role_here === true,
    pendingHere: row?.pending_here === true,
    elsewhere: row?.elsewhere === true,
  };
}

/** Nothing here, but serves or has registered in another ministry. */
export function belongsElsewhere(a: AccessHere): boolean {
  return !a.roleHere && !a.pendingHere && a.elsewhere;
}
