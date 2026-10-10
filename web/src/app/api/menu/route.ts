import { cookies } from "next/headers";
import { NextResponse } from "next/server";
import { getAppSettings } from "@/lib/app-settings";
import {
  buildSwitcherEntries,
  coordinatorCombinedName,
  coordinatorScope,
  getAccessibleGroups,
  LAST_GROUP_COOKIE,
  getServingGroups,
  pickDefaultGroupId,
} from "@/lib/groups";
import type { MenuData } from "@/lib/menu-types";
import { getPendingServantsCount } from "@/lib/pending-servants";
import { getAccessSummary } from "@/lib/roles";
import { createClient } from "@/lib/supabase/server";

/**
 * SIDE_MENU_PLAN.md §3.4 -- everything the side menu shows, as plain JSON.
 *
 * Owner-reported: the menu took too long to appear. This used to be a
 * server action, which Next.js dispatches one at a time behind any other
 * action or navigation in flight (its docs: server functions are for
 * mutations, not reads). A GET route runs independently, so the browser
 * can fetch it quietly in the background before the burger is ever tapped
 * (MenuButton). Identity comes from getClaims(), which checks the sign-in
 * token locally instead of getUser()'s extra round trip to the Auth server
 * -- the same check the proxy already relies on for every request.
 */
export async function GET() {
  const supabase = await createClient();
  const { data: claims } = await supabase.auth.getClaims();
  const userId = claims?.claims?.sub;
  if (!userId) return NextResponse.json(null, { status: 401 });

  const [access, settings, groups, pendingServantsCount, cookieStore, { data: unread }, { data: unreadMsgs }] = await Promise.all([
    getAccessSummary(userId),
    getAppSettings(),
    getAccessibleGroups(),
    getPendingServantsCount(),
    cookies(),
    supabase.rpc("my_announcement_badge"),
    supabase.rpc("my_unread_messages"),
  ]);
  const isAdminOrGeneralCoordinator = access.isAdmin || access.isGeneralCoordinator;

  const data: MenuData = {
    isAdmin: access.isAdmin,
    isCoordinator: access.isCoordinator || access.isAdmin,
    isAdminOrGeneralCoordinator,
    pendingServantsCount: isAdminOrGeneralCoordinator ? pendingServantsCount : 0,
    unreadAnnouncements: typeof unread === "number" ? unread : 0,
    unreadMessages: typeof unreadMsgs === "number" ? unreadMsgs : 0,
    universityLabel: settings.university_label,
    groupLabel: settings.group_label,
    appVersion: settings.app_version,
    cohorts: buildSwitcherEntries(
      groups,
      access,
      `All ${settings.group_label}s Combined`,
      coordinatorCombinedName(coordinatorScope(groups, access), settings.ladder_position_label, settings.level_number_offset),
    ),
    defaultCohortId: pickDefaultGroupId(groups, access, cookieStore.get(LAST_GROUP_COOKIE)?.value),
    servingCohortIds: getServingGroups(groups, access).map((g) => g.id),
    fallbackCohortId: pickDefaultGroupId(groups, access, undefined),
  };
  // Per person, never shared: no CDN or browser HTTP caching. The browser
  // keeps its own copy for the session instead (menuStore).
  return NextResponse.json(data, { headers: { "Cache-Control": "private, no-store" } });
}
