import { getDashboardStatsData, getUpcomingBirthdays, getUnassignedMembers, getNewlyAssignedMembers } from "@/lib/dashboard";
import { getActionsNeeded, getActionsNeededConfig } from "@/lib/actions-needed";
import { getFollowUpsDue } from "@/lib/outreach";
import { getServantsForGroup } from "@/lib/servants";
import { getUniversities } from "@/lib/universities";
import { getAppSettings } from "@/lib/app-settings";
import { getAccessSummary, canEditGroup } from "@/lib/roles";
import { getCombinedGroups } from "@/lib/groups";
import { createClient } from "@/lib/supabase/server";
import { getCurrentUser } from "@/lib/supabase/get-current-user";
import { DashboardInteractive } from "@/components/dashboard/DashboardInteractive";
import { CombinedDashboardOverview } from "@/components/dashboard/CombinedDashboardOverview";
import { ALL_COHORTS_GROUP_ID } from "@/lib/allCohorts";

export default async function DashboardPage({ params }: { params: Promise<{ groupId: string }> }) {
  const { groupId } = await params;

  if (groupId === ALL_COHORTS_GROUP_ID) {
    const [combinedGroups, settings] = await Promise.all([getCombinedGroups(), getAppSettings()]);
    const groups = await Promise.all(
      combinedGroups.map(async (g) => ({ groupId: g.id, groupName: g.name, statsData: await getDashboardStatsData(g.id) })),
    );
    return (
      <div className="mt-4">
        <CombinedDashboardOverview groups={groups} memberLabel={settings.member_label} />
      </div>
    );
  }

  const supabase = await createClient();
  const user = await getCurrentUser();

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
      ? supabase.from("profiles").select("full_name").eq("id", user.id).maybeSingle().then((r) => r.data)
      : Promise.resolve(null),
  ]);

  const memberLabel = settings.member_label;
  const canDelete = access?.isAdmin || access?.isGeneralCoordinator || false;
  const canEdit = access ? canEditGroup(access, groupId) : false;
  const currentUserName = profile?.full_name ?? user?.email ?? "Unknown";

  return (
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
    />
  );
}
