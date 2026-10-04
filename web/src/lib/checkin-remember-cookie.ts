/** Owner-requested: lets a servant or youth search for their own name once,
 * then be pre-highlighted on future visits to that same check-in QR from
 * the same device/browser -- opt-out via a "Remember me on this device"
 * checkbox (default checked) rather than an upfront consent prompt, per
 * the owner's explicit design (matches the existing "Not you? Undo"
 * philosophy: no extra friction on the common case). Only ever stores an
 * opaque member/profile/pending-servant id -- never a name.
 *
 * Separate cookies for the two flows: a device used for both (e.g. a
 * coordinator who also happens to be a group's Servant) shouldn't have one
 * flow's remembered person bleed into the other's list. */
// Neutral names (were "say_..."): each ministry's own web address keeps its
// own cookies anyway. One-time effect of the rename: a device that ticked
// "Remember me" is simply asked to pick its name once more.
export const SERVANT_CHECKIN_COOKIE = "servant_checkin";
export const MEMBER_CHECKIN_COOKIE = "member_checkin";
export const CHECKIN_REMEMBER_COOKIE_MAX_AGE = 60 * 60 * 24 * 365; // 1 year

export type RememberedCheckinPerson = { id: string; kind: "member" | "servant" | "pending" };

export function parseRememberedCheckinPerson(raw: string | null | undefined): RememberedCheckinPerson | null {
  if (!raw) return null;
  const [id, kind] = raw.split(":");
  if (!id || !/^[0-9a-f-]{36}$/i.test(id) || (kind !== "member" && kind !== "servant" && kind !== "pending")) return null;
  return { id, kind };
}

export function serializeRememberedCheckinPerson(person: RememberedCheckinPerson): string {
  return `${person.id}:${person.kind}`;
}
