import { getDashboardStatsData, getUpcomingBirthdays, getUnassignedMembers, getNewlyAssignedMembers } from "@/lib/dashboard";
import { getActionsNeeded, getActionsNeededConfig } from "@/lib/actions-needed";
import { getFollowUpsDue } from "@/lib/outreach";
import { getServantsForGroup } from "@/lib/servants";
import { getUniversities } from "@/lib/universities";
import { getAppSettings } from "@/lib/app-settings";
import { getAccessSummary, canEditGroup } from "@/lib/roles";
import { getCombinedGroups } from "@/lib/groups";
import { getCombinedDashboardData } from "@/lib/dashboard-combined";
import { createClient } from "@/lib/supabase/server";
import { getCurrentUser } from "@/lib/supabase/get-current-user";
import { DashboardInteractive } from "@/components/dashboard/DashboardInteractive";
import { AnnouncementBanners } from "@/components/announcements/AnnouncementBanners";
import { CheckinAlertBanner } from "@/components/dashboard/CheckinAlertBanner";
import { ALL_COHORTS_GROUP_ID } from "@/lib/allCohorts";
import { getDashboardStartOpen } from "@/lib/dashboard-prefs-server";
import { getMyServantTeam, type ServantTeamRow } from "@/lib/servant-team";
import type { AccessSummary } from "@/lib/roles";

type DashboardProfile = { full_name: string; birthday_month: number | null; birthday_ask_after: string | null } | null;

/** Owner-requested (15 Oct 2026, migration 0116): the one-time birthday card
 * is for anyone serving who hasn't given theirs, unless they said "Not now"
 * (until then) or "No thanks" ('infinity', never again). */
function shouldAskBirthday(access: AccessSummary | null, profile: DashboardProfile): boolean {
  if (!access || !profile || !(access.isServant || access.isCoordinator)) return false;
  if (profile.birthday_month !== null) return false;
  const after = profile.birthday_ask_after;
  return !after || (after !== "infinity" && new Date(after).getTime() <= Date.now());
}

/** This sign-in's id (from the sign-in token, checked locally): the
 * Dashboard remembers opened/closed panels until it ends (owner-requested
 * 15 Oct 2026). */
async function getSignInKey(supabase: Awaited<ReturnType<typeof createClient>>): Promise<string> {
  const { data } = await supabase.auth.getClaims();
  return String(data?.claims?.session_id ?? "signed-in");
}

/** My Servants Team (0116): Coordinators, General Coordinators and System
 * Admins (who see the General Coordinators' view, owner-requested 15 Oct). */
function servantTeamFor(access: AccessSummary | null): Promise<ServantTeamRow[]> {
  return access && (access.isGeneralCoordinator || access.isAdmin || access.isSubCoordinator)
    ? getMyServantTeam()
    : Promise.resolve([]);
}

export default async function DashboardPage({ params }: { params: Promise<{ groupId: string }> }) {
  const { groupId } = await params;

  const supabase = await createClient();
  const user = await getCurrentUser();

  // Combined view (owner-requested 30 Sep 2026): the full Dashboard over
  // every group of the view, each item tagged with its group so the
  // header's cohort checkboxes (CohortFilter) can narrow it. All sections
  // come from a few reads over every group at once (getCombinedDashboardData).
  if (groupId === ALL_COHORTS_GROUP_ID) {
    const [combinedGroups, actionsNeededConfig, settings, access, profile, universities] = await Promise.all([
      getCombinedGroups(),
      getActionsNeededConfig(),
      getAppSettings(),
      user ? getAccessSummary(user.id) : Promise.resolve(null),
      user
        ? supabase
            .from("profiles")
            .select("full_name, birthday_month, birthday_ask_after")
            .eq("id", user.id)
            .maybeSingle()
            .then((r) => r.data as DashboardProfile)
        : Promise.resolve(null),
      getUniversities(),
    ]);
    const ids = combinedGroups.map((g) => g.id);
    const [data, servants, startOpen, servantTeam, signInKey] = await Promise.all([
      getCombinedDashboardData(ids),
      ids.length > 0 ? getServantsForGroup(ids) : Promise.resolve([]),
      getDashboardStartOpen(),
      servantTeamFor(access),
      getSignInKey(supabase),
    ]);
    const canEditAll = access?.isAdmin || access?.isGeneralCoordinator || false;
    const editableGroupIds = ids.filter((id) => (access ? canEditGroup(access, id) : false));

    return (
      <>
        {access?.isAdmin && <CheckinAlertBanner />}
        <AnnouncementBanners />
        <DashboardInteractive
          groupId={groupId}
          combinedGroupIds={ids}
          combinedGroups={combinedGroups}
          groupLabel={settings.group_label}
          canEditAll={canEditAll}
          editableGroupIds={editableGroupIds}
          statsData={data.statsData}
          birthdays={data.birthdays}
          birthdayWindowDays={{ before: settings.birthday_window_days_before, after: settings.birthday_window_days_after }}
          unassigned={data.unassigned}
          actionsNeeded={data.actionsNeeded}
          actionsNeededConfig={
            settings.proximity_enabled ? actionsNeededConfig : actionsNeededConfig.filter((c) => c.proximity === "Local")
          }
          actionsNeededLookbackMonths={settings.actions_needed_lookback_months}
          proximityEnabled={settings.proximity_enabled}
          universityLabel={settings.university_label}
          programLabel={settings.program_label}
          newlyAssigned={data.newlyAssigned}
          followUpsDue={data.followUpsDue}
          servants={servants}
          universities={universities}
          memberLabel={settings.member_label}
          canDelete={canEditAll}
          canEdit={editableGroupIds.length > 0}
          currentUserId={user?.id ?? ""}
          currentUserName={profile?.full_name ?? user?.email ?? "Unknown"}
          startOpen={startOpen}
          servantTeam={servantTeam}
          isGeneralCoordinator={(access?.isGeneralCoordinator || access?.isAdmin) ?? false}
          servantAbsenceWeeks={settings.servant_absence_weeks}
          servantQuietDays={settings.servant_quiet_days}
          askBirthday={shouldAskBirthday(access, profile)}
          signInKey={signInKey}
        />
      </>
    );
  }

  const [
    statsData,
    birthdays,
    unassigned,
    actionsNeeded,
    actionsNeededConfig,
    newlyAssigned,
    followUpsDue,
    servants,
    universities,
    settings,
    access,
    profile,
    startOpen,
    signInKey,
  ] = await Promise.all([
    getDashboardStatsData(groupId),
    getUpcomingBirthdays(groupId),
    getUnassignedMembers(groupId),
    getActionsNeeded(groupId),
    getActionsNeededConfig(),
    getNewlyAssignedMembers(groupId),
    getFollowUpsDue(groupId),
    getServantsForGroup(groupId),
    getUniversities(),
    getAppSettings(),
    user ? getAccessSummary(user.id) : Promise.resolve(null),
    user
      ? supabase
          .from("profiles")
          .select("full_name, birthday_month, birthday_ask_after")
          .eq("id", user.id)
          .maybeSingle()
          .then((r) => r.data as DashboardProfile)
      : Promise.resolve(null),
    getDashboardStartOpen(),
    getSignInKey(supabase),
  ]);
  const servantTeam = await servantTeamFor(access);

  const memberLabel = settings.member_label;
  const canDelete = access?.isAdmin || access?.isGeneralCoordinator || false;
  const canEdit = access ? canEditGroup(access, groupId) : false;
  const currentUserName = profile?.full_name ?? user?.email ?? "Unknown";

  return (
    <>
      {access?.isAdmin && <CheckinAlertBanner />}
      <AnnouncementBanners />
      <DashboardInteractive
        groupId={groupId}
        statsData={statsData}
        birthdays={birthdays}
        birthdayWindowDays={{ before: settings.birthday_window_days_before, after: settings.birthday_window_days_after }}
        unassigned={unassigned}
        actionsNeeded={actionsNeeded}
        actionsNeededConfig={
          settings.proximity_enabled ? actionsNeededConfig : actionsNeededConfig.filter((c) => c.proximity === "Local")
        }
        actionsNeededLookbackMonths={settings.actions_needed_lookback_months}
        proximityEnabled={settings.proximity_enabled}
        universityLabel={settings.university_label}
        programLabel={settings.program_label}
        newlyAssigned={newlyAssigned}
        followUpsDue={followUpsDue}
        servants={servants}
        universities={universities}
        memberLabel={memberLabel}
        canDelete={canDelete}
        canEdit={canEdit}
        currentUserId={user?.id ?? ""}
        currentUserName={currentUserName}
        startOpen={startOpen}
        servantTeam={servantTeam}
        isGeneralCoordinator={(access?.isGeneralCoordinator || access?.isAdmin) ?? false}
        servantAbsenceWeeks={settings.servant_absence_weeks}
        servantQuietDays={settings.servant_quiet_days}
        askBirthday={shouldAskBirthday(access, profile)}
        signInKey={signInKey}
      />
    </>
  );
}
