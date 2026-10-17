import { currentAnnouncementsAction } from "@/app/announcements/actions";
import type { CurrentAnnouncement } from "@/lib/announcements";

/** Owner-requested (17 Oct 2026, free hosting allowance): the dashboard
 * banners and the Important pop-up both need "my current announcements";
 * they now share one server request (kept for a minute) instead of two. */
const KEEP_MS = 60_000;
let last: { at: number; promise: Promise<CurrentAnnouncement[]> } | null = null;

export function loadCurrentAnnouncements(): Promise<CurrentAnnouncement[]> {
  if (last && Date.now() - last.at < KEEP_MS) return last.promise;
  const promise = currentAnnouncementsAction().catch(() => [] as CurrentAnnouncement[]);
  last = { at: Date.now(), promise };
  return promise;
}

/** After a dismiss or "Got it", the next look asks the server again. */
export function forgetCurrentAnnouncements() {
  last = null;
}
