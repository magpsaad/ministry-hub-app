import type { MemberListItem } from "@/lib/members";
import type { University } from "@/lib/universities";
import type { ServantOption } from "@/lib/servants";
import type { GroupSummary } from "@/lib/groups";
import { MemberDetailLink } from "./MemberDetailLink";
import { MemberAttendanceLink } from "@/components/attendance/MemberAttendanceLink";
import { PhoneLink } from "@/components/PhoneLink";
import { memberPhotoUrl } from "@/lib/storage";
import { ALL_COHORTS_GROUP_ID } from "@/lib/allCohorts";

const PROXIMITY_BADGE: Record<string, string> = {
  Local: "bg-[#d1ecf1] text-[#0c5460]",
  Regional: "bg-[#fff3cd] text-[#856404]",
  Abroad: "bg-[#f8d7da] text-[#721c24]",
  Unknown: "bg-[#e2e3e5] text-[#383d41]",
};

export function MemberGrid({
  members,
  groupId,
  groups,
  groupLabel,
  universities,
  universityLabel,
  programLabel,
  proximityEnabled,
  windowWeeks,
  serviceWeekdayDates,
  servants,
  memberLabel,
  canDelete,
  canEditAll,
  editableGroupIds,
  currentUserName,
}: {
  members: MemberListItem[];
  groupId: string;
  groups: GroupSummary[];
  groupLabel: string;
  universities: University[];
  universityLabel: string;
  programLabel: string;
  proximityEnabled: boolean;
  windowWeeks: number | null;
  serviceWeekdayDates: string[];
  servants: ServantOption[];
  memberLabel: string;
  canDelete: boolean;
  canEditAll: boolean;
  editableGroupIds: string[];
  currentUserName: string;
}) {
  const editableGroupIdSet = new Set(editableGroupIds);
  const isCombined = groupId === ALL_COHORTS_GROUP_ID;

  if (members.length === 0) {
    return <p className="mt-6 text-center text-sm text-[#666]">No {memberLabel.toLowerCase()}s match these filters.</p>;
  }

  return (
    <div className="mt-4 grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
      {members.map((m) => {
        const proximity = m.university?.proximity ?? "Unknown";
        const photoUrl = memberPhotoUrl(m.photo_path);
        const canEdit = canEditAll || editableGroupIdSet.has(m.group_id);
        return (
          <div
            key={m.id}
            className="rounded-xl bg-white shadow-[0_4px_20px_rgba(0,0,0,0.06)] border-l-4 border-brand p-4 hover:-translate-y-1 hover:shadow-[0_4px_15px_rgba(0,0,0,0.15)] transition-all"
          >
            <div className="flex items-center gap-3">
              <div className="h-[50px] w-[50px] shrink-0 rounded-full bg-brand text-white font-bold flex items-center justify-center overflow-hidden">
                {photoUrl ? (
                  // eslint-disable-next-line @next/next/no-img-element
                  <img src={photoUrl} alt={m.full_name} className="h-full w-full object-cover" />
                ) : (
                  m.full_name
                    .split(" ")
                    .map((w) => w[0])
                    .slice(0, 2)
                    .join("")
                )}
              </div>
              <div className="min-w-0">
                <MemberDetailLink
                  memberId={m.id}
                  groupId={groupId}
                  groups={groups}
                  groupLabel={groupLabel}
                  universities={universities}
                  universityLabel={universityLabel}
                  programLabel={programLabel}
                  servants={servants}
                  memberLabel={memberLabel}
                  canDelete={canDelete}
                  canEdit={canEdit}
                  currentUserName={currentUserName}
                  className="font-semibold text-brand hover:underline text-left truncate block"
                >
                  {m.full_name}
                  {m.is_visitor && (
                    <span className="ml-2 rounded-full bg-[#ffe5cc] text-[#b35900] text-[10px] font-semibold px-2 py-0.5 align-middle">
                      Visitor
                    </span>
                  )}
                </MemberDetailLink>
                <p className="text-xs text-[#666] truncate">
                  {m.university?.name ?? "—"}
                  {m.program_of_study ? ` · ${m.program_of_study}` : ""}
                </p>
                {m.phone && <PhoneLink phone={m.phone} className="text-xs" />}
              </div>
            </div>
            <div className="mt-2 flex items-center justify-between gap-2">
              {proximityEnabled && (
                <span className={`rounded-full px-2.5 py-0.5 text-[11px] font-semibold ${PROXIMITY_BADGE[proximity]}`}>
                  {proximity}
                </span>
              )}
              {isCombined && m.group && (
                <span className="rounded-full bg-[#e2e8f0] text-brand text-[11px] font-semibold px-2.5 py-0.5 truncate">
                  {m.group.name}
                </span>
              )}
              <span className="ml-auto text-[11px] text-[#666] truncate">
                {m.assigned_servant?.full_name ?? "Unassigned"}
              </span>
            </div>
            <p className="mt-1 text-[11px] text-[#666]">
              Attendance:{" "}
              {m.avgAttendancePercent === null ? (
                "N/A"
              ) : (
                <MemberAttendanceLink
                  memberId={m.id}
                  fullName={m.full_name}
                  joinDate={m.join_date}
                  serviceWeekdayDates={serviceWeekdayDates}
                  windowWeeks={windowWeeks}
                  title={
                    <MemberDetailLink
                      memberId={m.id}
                      groupId={groupId}
                      groups={groups}
                      groupLabel={groupLabel}
                      universities={universities}
                      universityLabel={universityLabel}
                      programLabel={programLabel}
                      servants={servants}
                      memberLabel={memberLabel}
                      canDelete={canDelete}
                      canEdit={canEdit}
                      currentUserName={currentUserName}
                      className="hover:underline text-left"
                    >
                      {m.full_name}
                    </MemberDetailLink>
                  }
                  className="font-semibold text-brand hover:underline"
                >
                  {m.avgAttendancePercent}%
                </MemberAttendanceLink>
              )}
            </p>
          </div>
        );
      })}
    </div>
  );
}
