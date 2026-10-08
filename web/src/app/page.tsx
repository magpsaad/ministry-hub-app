import Link from "next/link";
import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { getAppSettings } from "@/lib/app-settings";
import { getAccessibleGroups, LAST_GROUP_COOKIE, pickDefaultGroupId } from "@/lib/groups";
import { getAccessSummary } from "@/lib/roles";
import { getRoleLabels } from "@/lib/role-labels-server";
import { getCurrentUser } from "@/lib/supabase/get-current-user";
import { ensureProfile } from "@/lib/supabase/ensure-profile";
import { logAudit } from "@/lib/audit";
import { AppLogo } from "@/components/AppLogo";
import { MenuButton } from "@/components/MenuButton";
import { BackButton } from "@/components/BackButton";
import { RefreshButton } from "@/components/RefreshButton";
import { HeaderWordmark } from "@/components/MinistryHubBrand";

/**
 * SIDE_MENU_PLAN.md §3.1 -- there is no landing page any more: `/` sends
 * each person straight to a Dashboard, and the old landing page's links
 * live in the side menu (MenuButton). Worked out fresh on every visit from
 * the current role rows, so it always follows the current assignment (D7),
 * whether that changed at year end or mid-year.
 *
 * 1. Serves one or more cohorts: that cohort's Dashboard. With several, the
 *    last one opened from the switcher if it's still one of theirs,
 *    otherwise the first listed (D4, D6). An Admin/General Coordinator who
 *    also serves a cohort lands here too (D3).
 * 2. Admin or General Coordinator without a cohort: the Combined Dashboard.
 * 3. Read-only access only: the first of those cohorts (owner-requested,
 *    replacing Q3 -- they used to land on "No group assigned yet").
 * 4. Anyone else (no cohort they can open at all): "No group assigned yet"
 *    (D5).
 * All of this lives in pickDefaultGroupId(), shared with the side menu.
 */
export default async function LandingPage() {
  const user = await getCurrentUser();
  if (!user) redirect("/login");

  await ensureProfile(user);
  void logAudit(user.id, "APP_ACCESS");

  const [access, groups, cookieStore] = await Promise.all([
    getAccessSummary(user.id),
    getAccessibleGroups(),
    cookies(),
  ]);

  const defaultGroupId = pickDefaultGroupId(groups, access, cookieStore.get(LAST_GROUP_COOKIE)?.value);
  if (defaultGroupId) redirect(`/g/${defaultGroupId}/dashboard`);

  const [settings, L] = await Promise.all([getAppSettings(), getRoleLabels()]);
  // The proxy gate (src/lib/supabase/proxy.ts) already redirects anyone
  // with no role at all to /register before they ever reach this page --
  // this is just a defensive fallback in case that somehow didn't fire.
  const hasAnyRole = access.isCoordinator || access.isServant || access.isReadOnly;

  return (
    <div className="min-h-full flex flex-col bg-[#f5f5f5]">
      <header className="bg-gradient-to-br from-brand to-brand-light text-white px-5 py-5 text-center shadow-[0_2px_10px_rgba(0,0,0,0.1)] relative sticky top-[var(--qa-banner-h)] z-40">
        <div className="inline-flex items-center justify-center gap-2">
          <AppLogo logoUrl={settings.logo_url} title={settings.app_title_short} size={32} circular={false} />
          <h1 className="text-2xl font-bold">{settings.app_title_short}</h1>
        </div>

        <div className="absolute top-2.5 right-4">
          <RefreshButton />
        </div>

        <div className="absolute top-2.5 left-4 flex flex-col items-start gap-1">
          <MenuButton />
          <BackButton />
        </div>
        <HeaderWordmark />
      </header>

      <main className="flex-1 max-w-2xl w-full mx-auto px-4 py-16 text-center">
        {hasAnyRole ? (
          <>
            <h2 className="text-lg font-bold text-[#333]">No {settings.group_label.toLowerCase()} assigned yet</h2>
            <p className="mt-2 text-sm text-[#666]">
              A {L.coordinatorLower} will assign you to a {settings.group_label.toLowerCase()}. Meanwhile, the menu at
              the top left has the {L.servant} Directory, Service Calendar and more.
            </p>
          </>
        ) : (
          <p className="text-sm text-[#666]">
            Your account isn&rsquo;t assigned to any role yet.{" "}
            <Link href="/register" className="underline">
              Register here
            </Link>
            , or contact a System Admin for access.
          </p>
        )}
      </main>
    </div>
  );
}
