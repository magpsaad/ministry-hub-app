import type { DashboardStatsData } from "@/lib/dashboard";
import { UsersIcon, CalendarCheckIcon, CalendarXIcon, UserXIcon } from "@/components/icons";
import { StatCard } from "@/components/dashboard/DashboardInteractive";

export type GroupDashboardStats = { groupId: string; groupName: string; statsData: DashboardStatsData };

/**
 * REQUIREMENTS.md §6.1 addendum -- the "Load Youth Data for all cohorts"
 * Dashboard: one Overview panel per cohort, each identified by its own
 * group name. Owner-reported scope for this combined view: Overview is the
 * ONLY Dashboard section that carries over -- Current Birthdays, New
 * Registrations, and Actions Needed are all dropped entirely rather than
 * attempting to merge/dedupe them across cohorts (those stay single-cohort-
 * only screens). No client interactivity needed here at all ("My Assigned
 * List" is also removed for this view -- GroupNavShell/MyAssignedProvider
 * already handle that), so this renders straight from the server, unlike
 * DashboardInteractive.
 */
export function CombinedDashboardOverview({ groups, memberLabel }: { groups: GroupDashboardStats[]; memberLabel: string }) {
  return (
    <div className="mt-4 space-y-6">
      {groups.map(({ groupId, groupName, statsData }) => {
        const totalMembers = statsData.rows.length;
        const neverAttended = statsData.rows.filter((r) => !r.everAttended).length;
        const presentLastServiceDate = statsData.lastServiceDate ? statsData.rows.filter((r) => r.presentLastService).length : null;
        // Owner-reported (same fix as the single-cohort Dashboard,
        // DashboardInteractive.tsx): Total = Present + Absent + Never
        // Attended, not Absent = everyone-not-present (which silently
        // folded in never-attended members too).
        const absentLastServiceDate = statsData.lastServiceDate ? totalMembers - (presentLastServiceDate ?? 0) - neverAttended : null;

        return (
          <section key={groupId} className="bg-white rounded-xl shadow-[0_4px_20px_rgba(0,0,0,0.06)] p-5">
            <h2 className="flex items-center gap-2 text-lg font-bold text-brand mb-4">
              <UsersIcon className="h-5 w-5" /> {groupName}
            </h2>
            <div className="grid grid-cols-2 sm:grid-cols-4 gap-4">
              <StatCard icon={<UsersIcon className="h-3.5 w-3.5" />} label={`Total ${memberLabel}s`} value={totalMembers} />
              <StatCard icon={<CalendarCheckIcon className="h-3.5 w-3.5" />} label="Present Last Service" value={presentLastServiceDate ?? "—"} />
              <StatCard icon={<CalendarXIcon className="h-3.5 w-3.5" />} label="Absent Last Service" value={absentLastServiceDate ?? "—"} />
              <StatCard icon={<UserXIcon className="h-3.5 w-3.5" />} label="Never Attended" value={neverAttended} />
            </div>
            {statsData.visitorCount > 0 && (
              <p className="mt-3 text-xs text-[#666]">
                The above counts exclude {statsData.visitorCount} visitor{statsData.visitorCount === 1 ? "" : "s"}.
              </p>
            )}
          </section>
        );
      })}
      {groups.length === 0 && <p className="text-sm text-[#666] text-center py-8">No cohorts to show.</p>}
    </div>
  );
}
