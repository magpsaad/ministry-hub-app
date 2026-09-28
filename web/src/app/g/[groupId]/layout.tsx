import { Suspense } from "react";
import { notFound, redirect } from "next/navigation";
import { getAppSettings } from "@/lib/app-settings";
import { getLastServiceDate } from "@/lib/dashboard";
import { getAccessSummary } from "@/lib/roles";
import { createClient } from "@/lib/supabase/server";
import { getCurrentUser } from "@/lib/supabase/get-current-user";
import { GroupNavShell } from "@/components/GroupNavShell";
import { MyAssignedProvider } from "@/components/MyAssignedContext";
import { ALL_COHORTS_GROUP_ID } from "@/lib/allCohorts";
import { Skeleton } from "@/components/Skeleton";

/**
 * Owner-reported: every tab under a cohort (Dashboard/Members/Attendance/
 * Outreach/Reports, including the "all cohorts" combined view -- which
 * experiences this worst, given how much more it fetches) felt like it took
 * "a few seconds" before anything appeared at all, even though each tab's
 * own page.tsx already streams its own data in behind a loading.tsx
 * skeleton. The real cause: THIS layout's own data (the access check, app
 * settings, last service date, and -- for a single cohort -- the group-name
 * lookup) ran first and blocked ALL rendering, header and tab bar included,
 * before a page's own loading.tsx ever got a chance to show anything. Per
 * this Next.js version's own loading.js docs: a layout's uncached fetches
 * are NOT covered by a child page's loading.tsx -- "navigation blocks until
 * the layout finishes rendering" unless the layout wraps its own data
 * access in its own Suspense boundary, which is what this file now does.
 *
 * GroupNavShell itself needs no data beyond its props, so the fallback
 * below renders the exact same component with safe placeholder values --
 * header/logo/tab bar all appear and are fully clickable (Home, every tab)
 * instantly, then swap to the real title/cohort name/last-service-date the
 * moment this layout's own fetch resolves. Once resolved, the requested
 * tab's own page renders inside it exactly as before, with its own
 * loading.tsx taking over for whatever that page still needs to fetch.
 *
 * The "are you even signed in" check stays here, OUTSIDE the Suspense
 * boundary -- confirmed by testing: moving it inside (alongside the
 * slower role/permission lookups) let `{children}` start rendering
 * concurrently with that check, so a signed-out hit would briefly let the
 * requested tab's own page fire its data query before the redirect won the
 * race, surfacing as a raw "permission denied" Postgres error in the
 * server logs (RLS still blocked it -- no data ever leaked -- but it's
 * noisy and wasted work). `getCurrentUser()` alone is cheap, so gating on
 * it here costs nothing.
 */
export default async function GroupLayout({
  children,
  params,
}: {
  children: React.ReactNode;
  params: Promise<{ groupId: string }>;
}) {
  const { groupId } = await params;
  const isCombined = groupId === ALL_COHORTS_GROUP_ID;

  const user = await getCurrentUser();
  if (!user) redirect("/login");

  return (
    <Suspense fallback={<GroupShellFallback groupId={groupId} combined={isCombined} />}>
      <GroupLayoutContent groupId={groupId} isCombined={isCombined} userId={user.id}>
        {children}
      </GroupLayoutContent>
    </Suspense>
  );
}

function GroupShellFallback({ groupId, combined }: { groupId: string; combined: boolean }) {
  const shell = (
    <GroupNavShell
      groupId={groupId}
      groupName=""
      appTitleShort=""
      memberLabel="Member"
      logoUrl={null}
      appVersion=""
      lastServiceDate={null}
      combined={combined}
    >
      <div className="mt-4 space-y-3">
        <Skeleton className="h-10 w-full" />
        <Skeleton className="h-24 w-full" />
      </div>
    </GroupNavShell>
  );
  // Matches the real content's wrapping below -- the combined view never
  // wraps in MyAssignedProvider (useMyAssigned() safely no-ops without one).
  return combined ? shell : <MyAssignedProvider>{shell}</MyAssignedProvider>;
}

async function GroupLayoutContent({
  children,
  groupId,
  isCombined,
  userId,
}: {
  children: React.ReactNode;
  groupId: string;
  isCombined: boolean;
  userId: string;
}) {
  const supabase = await createClient();

  // The group lookup runs in the same parallel batch as everything else
  // (it used to wait for this batch first -- one extra round trip before
  // the header could render).
  const [access, settings, lastServiceDate, groupResult] = await Promise.all([
    getAccessSummary(userId),
    getAppSettings(),
    getLastServiceDate(),
    isCombined ? Promise.resolve(null) : supabase.from("groups").select("id, name").eq("id", groupId).maybeSingle(),
  ]);

  if (isCombined) {
    // Owner-reported access rule: Admin and General Coordinator only, NOT
    // Sub-Coordinator -- a Sub-Coordinator only ever has one cohort
    // anyway, so this would just duplicate the ordinary "Load [Member]
    // Data" flow for them. Admin gets it by default ("Admin should have
    // access to everything"). Deliberately narrower than the rest of this
    // layout, which otherwise defers entirely to RLS/per-page checks.
    if (!access.isAdmin && !access.isGeneralCoordinator) {
      return (
        <div className="min-h-full flex items-center justify-center bg-[#f5f5f5] p-4">
          <p className="text-sm text-[#666]">You don&rsquo;t have access to this page.</p>
        </div>
      );
    }

    return (
      <GroupNavShell
        groupId={ALL_COHORTS_GROUP_ID}
        groupName={`All ${settings.group_label}s Combined`}
        appTitleShort={settings.app_title_short}
        memberLabel={settings.member_label}
        logoUrl={settings.logo_url}
        appVersion={settings.app_version}
        lastServiceDate={lastServiceDate}
        combined
      >
        {children}
      </GroupNavShell>
    );
  }

  const group = groupResult?.data ?? null;

  // RLS returns no row at all if this user can't access the group -- treated
  // the same as a bad ID, rather than leaking whether it exists.
  if (!group) notFound();

  return (
    <MyAssignedProvider>
      <GroupNavShell
        groupId={group.id}
        groupName={group.name}
        appTitleShort={settings.app_title_short}
        memberLabel={settings.member_label}
        logoUrl={settings.logo_url}
        appVersion={settings.app_version}
        lastServiceDate={lastServiceDate}
      >
        {children}
      </GroupNavShell>
    </MyAssignedProvider>
  );
}
