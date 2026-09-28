const PHOTOS_BUCKET = `${process.env.NEXT_PUBLIC_APP_ENV}-photos`;
const CALENDAR_BUCKET = `${process.env.NEXT_PUBLIC_APP_ENV}-calendar`;

/** Public URL for a stored photo path -- predictable for public buckets, no
 * API round-trip needed. Works in both server and client code since
 * NEXT_PUBLIC_* vars are inlined at build time either way.
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
  return `${process.env.NEXT_PUBLIC_SUPABASE_URL}/storage/v1/object/public/${PHOTOS_BUCKET}/${path}`;
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

export function calendarAttachmentUrl(path: string | null): string | null {
  if (!path) return null;
  return `${process.env.NEXT_PUBLIC_SUPABASE_URL}/storage/v1/object/public/${CALENDAR_BUCKET}/${path}`;
}

export function calendarBucket(): string {
  return CALENDAR_BUCKET;
}
