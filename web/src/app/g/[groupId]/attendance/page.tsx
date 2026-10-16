import { getAttendanceBundle } from "@/lib/attendance";
import { getAppSettings } from "@/lib/app-settings";
import { getCombinedGroups } from "@/lib/groups";
import { getUniversities } from "@/lib/universities";
import { getServantsForGroup } from "@/lib/servants";
import { getAccessSummary } from "@/lib/roles";
import { createClient } from "@/lib/supabase/server";
import { getCurrentUser } from "@/lib/supabase/get-current-user";
import { AttendanceInteractive } from "@/components/attendance/AttendanceInteractive";
import { ALL_COHORTS_GROUP_ID } from "@/lib/allCohorts";

export default async function AttendancePage({ params }: { params: Promise<{ groupId: string }> }) {
  const { groupId } = await params;
  const supabase = await createClient();
  const user = await getCurrentUser();

  // "Load Youth Data for all cohorts" (REQUIREMENTS.md §6.1 addendum) --
  // no UI/feature changes here (owner: "No change"), just every accessible
  // cohort's members/attendance combined into one bundle.
  const combinedGroups = groupId === ALL_COHORTS_GROUP_ID ? await getCombinedGroups() : [];
  const groupIds = groupId === ALL_COHORTS_GROUP_ID ? combinedGroups.map((g) => g.id) : groupId;

  // Universities/servants/access/profile: what the youth record (Member
  // Detail modal) needs -- the attendance-history popup's name links to it
  // (owner-requested), same data and same per-cohort edit rules as the
  // Member List page.
  const [bundle, settings, universities, servants, access, profile] = await Promise.all([
    getAttendanceBundle(groupIds),
    getAppSettings(),
    getUniversities(),
    getServantsForGroup(groupIds),
    user ? getAccessSummary(user.id) : Promise.resolve(null),
    user
      ? supabase.from("profiles").select("full_name").eq("id", user.id).maybeSingle().then((r) => r.data)
      : Promise.resolve(null),
  ]);

  const canEditAll = access?.isAdmin || access?.isGeneralCoordinator || false;
  const editableGroupIds = (access?.roles ?? [])
    .filter((r) => r.role !== "read_only" && r.group_id)
    .map((r) => r.group_id as string);
  // Migration 0118: Read-only may take attendance if the ministry allows it.
  const readOnlyAttendanceGroupIds = settings.read_only_can_take_attendance
    ? (access?.roles ?? []).filter((r) => r.role === "read_only" && r.group_id).map((r) => r.group_id as string)
    : [];

  return (
    <AttendanceInteractive
      groupId={groupId}
      bundle={bundle}
      memberLabel={settings.member_label}
      showProximity={settings.proximity_enabled && settings.show_proximity_on_attendance}
      currentUserId={user?.id ?? ""}
      readOnlyAttendanceGroupIds={readOnlyAttendanceGroupIds}
      memberRecord={{
        groups: combinedGroups,
        groupLabel: settings.group_label,
        universities,
        universityLabel: settings.university_label,
        programLabel: settings.program_label,
        servants,
        canDelete: canEditAll,
        canEditAll,
        editableGroupIds,
        currentUserName: profile?.full_name ?? user?.email ?? "Unknown",
      }}
    />
  );
}
