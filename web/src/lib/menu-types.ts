import type { SwitcherEntry } from "@/lib/groups";

/** Everything the side menu shows (SIDE_MENU_PLAN.md §3.2). Types only, so
 * the browser-side menu code can import it without pulling in server code. */
export type MenuData = {
  isAdmin: boolean;
  isCoordinator: boolean;
  isAdminOrGeneralCoordinator: boolean;
  pendingServantsCount: number;
  /** Announcements for me showing now that I haven't opened (0099). */
  unreadAnnouncements: number;
  /** Conversations with a message I haven't read (0102). */
  unreadMessages: number;
  universityLabel: string;
  groupLabel: string;
  appVersion: string;
  cohorts: SwitcherEntry[];
  /** The person's default cohort (where `/` lands them), shown on the
   * menu's cohort row; null when they have none. */
  defaultCohortId: string | null;
};
