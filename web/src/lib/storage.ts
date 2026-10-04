const PHOTOS_BUCKET = `${process.env.NEXT_PUBLIC_APP_ENV}-photos`;
const CALENDAR_BUCKET = `${process.env.NEXT_PUBLIC_APP_ENV}-calendar`;
const BRANDING_BUCKET = `${process.env.NEXT_PUBLIC_APP_ENV}-branding`;

/** MULTI_TENANT_PLAN.md §7 -- every ministry has its own folder in each
 * bucket ("SAY/members/…", "HSM/profiles/…"). The storage write rules look
 * at that first folder: only that ministry's approved users (or the Church
 * Admin) may upload, replace or delete there. The stored path includes the
 * folder, so the public-URL helpers below need no change. Files uploaded
 * before this (flat paths) keep working until they're moved into SAY/. */
export type StorageFolder = "members" | "profiles" | "calendar" | "branding";

export function ministryFilePath(ministryId: string, folder: StorageFolder, fileName: string): string {
  return `${ministryId}/${folder}/${fileName}`;
}

/** The address the app shows a stored photo at. Owner-requested (3 Oct
 * 2026): photos are private (migration 0075), so this is the app's own
 * /api/photo address, which checks the signed-in person may see it and then
 * hands the browser an hour-long storage link -- never a public storage
 * address. Works in both server and client code.
 *
 * A path that is already a full web address (a Google profile picture,
 * saved at first sign-in by lib/supabase/ensure-profile.ts) is returned
 * as-is -- it used to be glued onto the storage URL, producing a broken
 * image (MULTI_TENANT_PLAN.md P12). */
export function isExternalPhotoUrl(path: string): boolean {
  return /^https?:\/\//i.test(path);
}

export function memberPhotoUrl(path: string | null): string | null {
  if (!path) return null;
  if (isExternalPhotoUrl(path)) return path;
  return `/api/photo?p=${encodeURIComponent(path)}`;
}

export function photosBucket(): string {
  return PHOTOS_BUCKET;
}

/** Same bucket/path scheme as memberPhotoUrl -- servants and members share
 * the one photos bucket (migration 0010's is_app_user() gate already covers
 * both), this is just a clearer name at servant call sites. */
export function servantPhotoUrl(path: string | null): string | null {
  return memberPhotoUrl(path);
}

/** Calendar attachments are private (migration 0085): the app's own
 * /api/attachment address checks the person is signed in to this ministry
 * and hands out an hour-long link -- never a public storage address. */
export function calendarAttachmentUrl(path: string | null): string | null {
  if (!path) return null;
  return `/api/attachment?p=${encodeURIComponent(path)}`;
}

export function calendarBucket(): string {
  return CALENDAR_BUCKET;
}

/** The ministry logo lives in the branding bucket; app_settings.logo_url
 * stores its full public web address (it can also be any other image
 * address an Admin pastes in). */
export function brandingBucket(): string {
  return BRANDING_BUCKET;
}

export function brandingPublicUrl(path: string): string {
  return `${process.env.NEXT_PUBLIC_SUPABASE_URL}/storage/v1/object/public/${BRANDING_BUCKET}/${path}`;
}
