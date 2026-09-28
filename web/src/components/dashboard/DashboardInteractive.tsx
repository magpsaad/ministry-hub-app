"use client";

import { useMemo, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { createPortal } from "react-dom";
import Link from "next/link";
import type { University } from "@/lib/universities";
import type { ServantOption } from "@/lib/servants";
import type { BirthdayMember, DashboardStatsData, NewlyAssignedMember, UnassignedMember } from "@/lib/dashboard";
import type { ActionsNeededMember } from "@/lib/actions-needed";
import type { FollowUpDueEntry } from "@/lib/outreach";
import { useMyAssigned } from "@/components/MyAssignedContext";
import { memberPhotoUrl } from "@/lib/storage";
import { CollapsibleSection } from "@/components/CollapsibleSection";
import { AssignServantSelect } from "@/components/members/AssignServantSelect";
import { MemberDetailLink } from "@/components/members/MemberDetailLink";
import { OutreachQuickLink } from "@/components/outreach/OutreachQuickLink";
import { ViewOutreachEntryModal } from "@/components/outreach/ViewOutreachEntryModal";
import { AddOutreachModal } from "@/components/outreach/AddOutreachModal";
import { PhoneLink } from "@/components/PhoneLink";
import {
  CakeIcon,
  UserPlusIcon,
  UsersIcon,
  UserXIcon,
  CalendarCheckIcon,
  CalendarXIcon,
  AlertTriangleIcon,
} from "@/components/icons";
import { dismissNewAssignmentAction } from "@/app/g/[groupId]/members/actions";
import { dismissFollowUpAction } from "@/app/g/[groupId]/outreach/actions";

type ActionsNeededConfigRow = {
  proximity: string;
  min_presence_count: number;
  min_absence_weeks: number;
  min_outreach_weeks: number;
};

type BirthdayWindowDays = { before: number; after: number };

/** Date-of-birth and follow_up_due are ISO date-only strings ("YYYY-MM-DD").
 * `new Date(iso)` parses that as UTC midnight, then local getters shift it
 * back a day in any timezone behind UTC -- parse the components by hand
 * instead (same fix as lib/dashboard.ts's getUpcomingBirthdays). */
function formatBirthdayDate(iso: string) {
  const [, month, day] = iso.split("-").map(Number);
  return new Date(2000, month - 1, day).toLocaleDateString(undefined, { month: "short", day: "numeric" });
}

function formatIsoDate(iso: string) {
  const [year, month, day] = iso.split("-").map(Number);
  return new Date(year, month - 1, day).toLocaleDateString();
}

/** "Sep 19", or "Sep 19, 2025" when it isn't this year. Components parsed by
 * hand for the same UTC-shift reason as formatBirthdayDate above. */
function formatJoinDate(iso: string) {
  const [year, month, day] = iso.split("-").map(Number);
  return new Date(year, month - 1, day).toLocaleDateString(undefined, {
    month: "short",
    day: "numeric",
    ...(year !== new Date().getFullYear() ? { year: "numeric" } : {}),
  });
}

function windowPhrase(days: number) {
  if (days === 0) return "today";
  if (days % 7 === 0) {
    const weeks = days / 7;
    return weeks === 1 ? "1 week" : `${weeks} weeks`;
  }
  return days === 1 ? "1 day" : `${days} days`;
}

function Avatar({ photoUrl, fullName }: { photoUrl: string | null; fullName: string }) {
  return photoUrl ? (
    // eslint-disable-next-line @next/next/no-img-element
    <img src={photoUrl} alt={fullName} className="h-10 w-10 rounded-full object-cover shrink-0" />
  ) : (
    <div className="h-10 w-10 shrink-0 rounded-full bg-brand text-white text-xs font-bold flex items-center justify-center">
      {fullName.split(" ").map((w) => w[0]).slice(0, 2).join("")}
    </div>
  );
}

type ActionsNeededCard =
  | { kind: "outreach"; sortKey: string; data: ActionsNeededMember }
  | { kind: "newly_assigned"; sortKey: string; data: NewlyAssignedMember }
  | { kind: "follow_up"; sortKey: string; data: FollowUpDueEntry };

export function DashboardInteractive({
  groupId,
  statsData,
  birthdays,
  birthdayWindowDays,
  unassigned,
  actionsNeeded,
  actionsNeededConfig,
  actionsNeededLookbackMonths,
  proximityEnabled,
  universityLabel,
  programLabel,
  newlyAssigned,
  followUpsDue,
  servants,
  universities,
  memberLabel,
  canDelete,
  canEdit,
  currentUserId,
  currentUserName,
}: {
  groupId: string;
  statsData: DashboardStatsData;
  birthdays: BirthdayMember[];
  birthdayWindowDays: BirthdayWindowDays;
  unassigned: UnassignedMember[];
  actionsNeeded: ActionsNeededMember[];
  actionsNeededConfig: ActionsNeededConfigRow[];
  actionsNeededLookbackMonths: number;
  proximityEnabled: boolean;
  universityLabel: string;
  programLabel: string;
  newlyAssigned: NewlyAssignedMember[];
  followUpsDue: FollowUpDueEntry[];
  servants: ServantOption[];
  universities: University[];
  memberLabel: string;
  canDelete: boolean;
  /** Owner-reported (Read-Only role bug follow-up): whether the Member
   * Detail modal's Edit button shows for this cohort -- Dashboard is
   * single-cohort, so unlike the Members list this is just one flag. */
  canEdit: boolean;
  currentUserId: string;
  currentUserName: string;
}) {
  const router = useRouter();
  const { myAssignedOnly, hydrated } = useMyAssigned();
  const applyFilter = hydrated && myAssignedOnly;
  const [showHelp, setShowHelp] = useState(false);
  const [viewingEntry, setViewingEntry] = useState<FollowUpDueEntry | null>(null);
  const [outreachForFollowUp, setOutreachForFollowUp] = useState<FollowUpDueEntry | null>(null);
  const [dismissPending, startDismiss] = useTransition();

  function handleDismissNewAssignment(memberId: string) {
    startDismiss(async () => {
      await dismissNewAssignmentAction(memberId, groupId);
      router.refresh();
    });
  }

  function handleDismissFollowUp(entryId: string) {
    startDismiss(async () => {
      await dismissFollowUpAction(groupId, entryId);
      router.refresh();
    });
  }

  const stats = useMemo(() => {
    const rows = applyFilter ? statsData.rows.filter((r) => r.assigned_servant_id === currentUserId) : statsData.rows;
    const totalMembers = rows.length;
    const neverAttended = rows.filter((r) => !r.everAttended).length;
    const presentLastServiceDate = statsData.lastServiceDate ? rows.filter((r) => r.presentLastService).length : null;
    // Owner-reported: Total = Present + Absent + Never Attended -- Absent
    // used to be "everyone not present" (totalMembers - present), which
    // silently folded in everyone who's never attended at all, inflating
    // it and double-counting them against the separate Never Attended
    // card.
    const absentLastServiceDate = statsData.lastServiceDate ? totalMembers - (presentLastServiceDate ?? 0) - neverAttended : null;
    return { totalMembers, neverAttended, presentLastServiceDate, absentLastServiceDate };
  }, [statsData, applyFilter, currentUserId]);

  const filteredBirthdays = applyFilter
    ? birthdays.filter((m) => m.assigned_servant_id === currentUserId)
    : birthdays;
  const filteredUnassigned = applyFilter
    ? unassigned.filter(() => false) // unassigned members can never be "mine"
    : unassigned;

  const visibleOutreachNeeded = useMemo(
    () => (applyFilter ? actionsNeeded.filter((m) => m.assigned_servant_id === currentUserId) : actionsNeeded),
    [actionsNeeded, applyFilter, currentUserId],
  );
  const visibleNewlyAssigned = useMemo(
    () => (applyFilter ? newlyAssigned.filter((m) => m.assigned_servant_id === currentUserId) : newlyAssigned),
    [newlyAssigned, applyFilter, currentUserId],
  );
  const visibleFollowUps = useMemo(
    () => (applyFilter ? followUpsDue.filter((f) => f.servant_id === currentUserId) : followUpsDue),
    [followUpsDue, applyFilter, currentUserId],
  );
  const totalActionsNeeded = visibleOutreachNeeded.length + visibleNewlyAssigned.length + visibleFollowUps.length;

  const actionsNeededByServant = useMemo(() => {
    const groups = new Map<string, ActionsNeededCard[]>();
    const push = (key: string, card: ActionsNeededCard) => {
      if (!groups.has(key)) groups.set(key, []);
      groups.get(key)!.push(card);
    };
    for (const m of visibleOutreachNeeded) {
      push(m.assignedServantName ?? "Unassigned", { kind: "outreach", sortKey: m.full_name, data: m });
    }
    for (const m of visibleNewlyAssigned) {
      push(m.assignedServantName, { kind: "newly_assigned", sortKey: m.full_name, data: m });
    }
    for (const f of visibleFollowUps) {
      push(f.servant_name, { kind: "follow_up", sortKey: f.member_name, data: f });
    }
    for (const cards of groups.values()) cards.sort((a, b) => a.sortKey.localeCompare(b.sortKey));
    return Array.from(groups.entries()).sort(([a], [b]) => (a === "Unassigned" ? 1 : b === "Unassigned" ? -1 : a.localeCompare(b)));
  }, [visibleOutreachNeeded, visibleNewlyAssigned, visibleFollowUps]);

  return (
    <div className="mt-4 space-y-6">
      <section className="bg-white rounded-xl shadow-[0_4px_20px_rgba(0,0,0,0.06)] p-5">
        <h2 className="flex items-center gap-2 text-lg font-bold text-brand mb-4">
          <UsersIcon className="h-5 w-5" /> Overview
        </h2>
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-4">
          <StatCard icon={<UsersIcon className="h-3.5 w-3.5" />} label={`Total ${memberLabel}s`} value={stats.totalMembers} />
          <StatCard icon={<CalendarCheckIcon className="h-3.5 w-3.5" />} label="Present Last Service" value={stats.presentLastServiceDate ?? "—"} />
          <StatCard icon={<CalendarXIcon className="h-3.5 w-3.5" />} label="Absent Last Service" value={stats.absentLastServiceDate ?? "—"} />
          <StatCard icon={<UserXIcon className="h-3.5 w-3.5" />} label="Never Attended" value={stats.neverAttended} />
        </div>
        {statsData.visitorCount > 0 && (
          <p className="mt-3 text-xs text-[#666]">
            The above counts exclude {statsData.visitorCount} visitor{statsData.visitorCount === 1 ? "" : "s"}.
          </p>
        )}
      </section>

      <CollapsibleSection
        id={`birthdays-${groupId}`}
        title={
          <span className="flex items-center gap-2">
            <CakeIcon className="h-5 w-5" /> Current Birthdays
          </span>
        }
      >
        {filteredBirthdays.length === 0 ? (
          <p className="text-sm text-[#666]">
            No birthdays in the last {windowPhrase(birthdayWindowDays.before)} or the next{" "}
            {windowPhrase(birthdayWindowDays.after)}.
          </p>
        ) : (
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
            {filteredBirthdays.map((m) => {
              const photoUrl = memberPhotoUrl(m.photo_path);
              return (
                <div key={m.id} className="rounded-lg bg-[#e2f0d9] border-l-4 border-[#28a745] p-3 flex items-center gap-3">
                  <Avatar photoUrl={photoUrl} fullName={m.full_name} />
                  <div className="min-w-0 flex-1">
                    <div className="flex items-center gap-2">
                      <MemberDetailLink
                        memberId={m.id}
                        groupId={groupId}
                        universities={universities} universityLabel={universityLabel} programLabel={programLabel}
                        servants={servants}
                        memberLabel={memberLabel}
                        canDelete={canDelete}
                        canEdit={canEdit}
                        currentUserName={currentUserName}
                        className="font-semibold text-brand hover:underline text-left truncate"
                      >
                        {m.full_name}
                      </MemberDetailLink>
                      <span className="text-[#28a745] font-medium text-sm shrink-0">
                        {formatBirthdayDate(m.date_of_birth)}
                      </span>
                    </div>
                    <p className="text-xs text-[#666]">
                      Assigned Servant: {m.assigned_servant?.full_name ?? "No assigned servant"}
                    </p>
                  </div>
                  <OutreachQuickLink
                    memberId={m.id}
                    memberName={m.full_name}
                    memberPhone={m.phone}
                    memberLabel={memberLabel}
                    groupId={groupId}
                    currentUserName={currentUserName}
                    className="shrink-0 rounded-md bg-brand px-3 py-1.5 text-xs font-semibold text-white hover:bg-brand-dark"
                  />
                </div>
              );
            })}
          </div>
        )}
      </CollapsibleSection>

      <CollapsibleSection
        id={`unassigned-${groupId}`}
        title={
          <span className="flex items-center gap-2">
            <UserPlusIcon className="h-5 w-5" /> New Registrations (Unassigned)
          </span>
        }
      >
        {filteredUnassigned.length === 0 ? (
          <p className="text-sm text-[#666]">
            {applyFilter
              ? "No unassigned members can be “mine” — turn off My Assigned List to see them."
              : `All ${memberLabel.toLowerCase()}s have been assigned to servants.`}
          </p>
        ) : (
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
            {filteredUnassigned.map((m) => {
              const photoUrl = memberPhotoUrl(m.photo_path);
              return (
                <div key={m.id} className="rounded-lg bg-[#e3f2fd] border-l-4 border-[#1976d2] p-3 flex items-center gap-3">
                  <Avatar photoUrl={photoUrl} fullName={m.full_name} />
                  <div className="min-w-0 flex-1">
                    <div className="flex items-baseline gap-1.5 flex-wrap">
                      <MemberDetailLink
                        memberId={m.id}
                        groupId={groupId}
                        universities={universities} universityLabel={universityLabel} programLabel={programLabel}
                        servants={servants}
                        memberLabel={memberLabel}
                        canDelete={canDelete}
                        canEdit={canEdit}
                        currentUserName={currentUserName}
                        className="font-semibold text-brand hover:underline text-left truncate"
                      >
                        {m.full_name}
                      </MemberDetailLink>
                      {m.joinedOn && (
                        <span className="text-[10px] text-[#666]">joined {formatJoinDate(m.joinedOn)}</span>
                      )}
                    </div>
                    <p className="text-xs text-[#666] truncate">
                      {m.university?.name ?? "—"}
                      {m.program_of_study ? ` · ${m.program_of_study}` : ""}
                    </p>
                    {/* Owner-reported: the phone number was wrapping onto
                        extra lines on a narrow screen, squeezed by the
                        Assign button next to it -- truncate (with the
                        button's own shrink-0 + shorter label) keeps it on
                        one line, ellipsizing only in the unlikely case
                        there's still not enough room. */}
                    {m.phone && <PhoneLink phone={m.phone} className="text-xs truncate" />}
                  </div>
                  <AssignServantSelect memberId={m.id} groupId={groupId} memberGender={m.gender} servants={servants} />
                </div>
              );
            })}
          </div>
        )}
      </CollapsibleSection>

      <CollapsibleSection
        id={`actions-needed-${groupId}`}
        title={
          <span className="flex items-center gap-2">
            <AlertTriangleIcon className="h-5 w-5" /> Actions Needed
            <button
              type="button"
              onClick={() => setShowHelp(true)}
              aria-label="What is Actions Needed?"
              className="h-5 w-5 flex items-center justify-center rounded-full bg-[#f0f0f0] text-[#666] text-xs font-bold hover:bg-[#e0e0e0]"
            >
              ?
            </button>
          </span>
        }
      >
        {totalActionsNeeded === 0 ? (
          <p className="text-sm text-[#666]">No outstanding Actions.</p>
        ) : (
          <div className="space-y-4">
            {actionsNeededByServant.map(([servantName, cards]) => (
              <div key={servantName}>
                <h3 className="text-sm font-bold text-brand mb-2">{servantName}</h3>
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
                  {cards.map((card) => {
                    if (card.kind === "outreach") {
                      const m = card.data;
                      const photoUrl = memberPhotoUrl(m.photo_path);
                      return (
                        <div
                          key={`outreach-${m.id}`}
                          className="rounded-lg bg-[#fff3cd] border-l-4 border-[#dc3545] p-3 flex items-center gap-3"
                        >
                          <Avatar photoUrl={photoUrl} fullName={m.full_name} />
                          <div className="min-w-0 flex-1">
                            <MemberDetailLink
                              memberId={m.id}
                              groupId={groupId}
                              universities={universities} universityLabel={universityLabel} programLabel={programLabel}
                              servants={servants}
                              memberLabel={memberLabel}
                              canDelete={canDelete}
                              canEdit={canEdit}
                              currentUserName={currentUserName}
                              className="font-semibold text-brand hover:underline text-left truncate block"
                            >
                              {m.full_name}
                            </MemberDetailLink>
                            <p className="text-xs text-[#721c24]">
                              Absent for {m.currentConsecutiveAbsences} week{m.currentConsecutiveAbsences === 1 ? "" : "s"}
                            </p>
                            <p className="text-xs text-[#666]">
                              Last outreach: {m.lastOutreachDate ? new Date(m.lastOutreachDate).toLocaleDateString() : "Never"}
                            </p>
                          </div>
                          {/* Owner-reported: Outreach was tucked below the
                              text on the left, unlike Birthdays' Outreach
                              button, which always sits on the right --
                              matched to that same placement here. */}
                          <OutreachQuickLink
                            memberId={m.id}
                            memberName={m.full_name}
                            memberPhone={m.phone}
                            memberLabel={memberLabel}
                            groupId={groupId}
                            currentUserName={currentUserName}
                            className="shrink-0 rounded-md bg-brand px-2.5 py-1 text-[11px] font-semibold text-white hover:bg-brand-dark"
                          />
                        </div>
                      );
                    }

                    if (card.kind === "newly_assigned") {
                      const m = card.data;
                      const photoUrl = memberPhotoUrl(m.photo_path);
                      return (
                        <div
                          key={`newly-${m.id}`}
                          className="rounded-lg bg-[#e3f2fd] border-l-4 border-[#1976d2] p-3 flex items-center gap-3"
                        >
                          <Avatar photoUrl={photoUrl} fullName={m.full_name} />
                          <div className="min-w-0 flex-1">
                            <div className="flex items-baseline gap-1.5 flex-wrap">
                              <MemberDetailLink
                                memberId={m.id}
                                groupId={groupId}
                                universities={universities} universityLabel={universityLabel} programLabel={programLabel}
                                servants={servants}
                                memberLabel={memberLabel}
                                canDelete={canDelete}
                                canEdit={canEdit}
                                currentUserName={currentUserName}
                                className="font-semibold text-brand hover:underline text-left truncate"
                              >
                                {m.full_name}
                              </MemberDetailLink>
                              <span className="text-[10px] text-[#666]">has been assigned to you</span>
                            </div>
                            <p className="text-xs text-[#666] truncate">
                              {m.university?.name ?? "—"}
                              {m.program_of_study ? ` · ${m.program_of_study}` : ""}
                            </p>
                            {m.phone && <PhoneLink phone={m.phone} className="text-xs" />}
                            {m.assigned_servant_id === currentUserId && (
                              <div className="mt-1">
                                <button
                                  type="button"
                                  onClick={() => handleDismissNewAssignment(m.id)}
                                  disabled={dismissPending}
                                  className="rounded-md bg-white px-2.5 py-1 text-[11px] font-semibold text-[#666] border border-[#ddd] hover:bg-[#f5f5f5] disabled:opacity-60"
                                >
                                  Dismiss
                                </button>
                              </div>
                            )}
                          </div>
                          {/* Owner-reported: Outreach was tucked below the
                              text on the left, unlike Birthdays' Outreach
                              button, which always sits on the right --
                              matched to that same placement here. Dismiss
                              stays below the text (a secondary action, not
                              the card's primary one). */}
                          <OutreachQuickLink
                            memberId={m.id}
                            memberName={m.full_name}
                            memberPhone={m.phone}
                            memberLabel={memberLabel}
                            groupId={groupId}
                            currentUserName={currentUserName}
                            className="shrink-0 rounded-md bg-brand px-2.5 py-1 text-[11px] font-semibold text-white hover:bg-brand-dark"
                          />
                        </div>
                      );
                    }

                    const f = card.data;
                    const photoUrl = memberPhotoUrl(f.member_photo_path);
                    return (
                      <div
                        key={`followup-${f.id}`}
                        className="rounded-lg bg-[#f3e5f5] border-l-4 border-[#8e44ad] p-3 flex items-center gap-3"
                      >
                        <Avatar photoUrl={photoUrl} fullName={f.member_name} />
                        <div className="min-w-0 flex-1">
                          {/* Owner-reported: this card's name wasn't
                              clickable, unlike the other two card kinds in
                              this section -- matched to the same
                              MemberDetailLink pattern they already use. */}
                          <MemberDetailLink
                            memberId={f.member_id}
                            groupId={groupId}
                            universities={universities} universityLabel={universityLabel} programLabel={programLabel}
                            servants={servants}
                            memberLabel={memberLabel}
                            canDelete={canDelete}
                            canEdit={canEdit}
                            currentUserName={currentUserName}
                            className="font-semibold text-brand hover:underline text-left truncate block"
                          >
                            {f.member_name}
                          </MemberDetailLink>
                          <p className="text-xs text-[#6a1b7a]">
                            Your follow-up is due {f.follow_up_due ? formatIsoDate(f.follow_up_due) : "—"}
                          </p>
                          <div className="mt-1 flex flex-wrap items-center gap-2">
                            <button
                              type="button"
                              onClick={() => setViewingEntry(f)}
                              className="rounded-md bg-white px-2.5 py-1 text-[11px] font-semibold text-[#6a1b7a] border border-[#8e44ad] hover:bg-[#f3e5f5]"
                            >
                              View original entry
                            </button>
                            {f.servant_id === currentUserId && (
                              <button
                                type="button"
                                onClick={() => handleDismissFollowUp(f.id)}
                                disabled={dismissPending}
                                className="rounded-md bg-white px-2.5 py-1 text-[11px] font-semibold text-[#666] border border-[#ddd] hover:bg-[#f5f5f5] disabled:opacity-60"
                              >
                                Dismiss
                              </button>
                            )}
                          </div>
                        </div>
                        {/* Owner-reported follow-up: Outreach right-
                            justified and vertically centered to match the
                            other Actions Needed cards exactly, while View
                            original entry/Dismiss stay together in their
                            own row on the left. */}
                        <button
                          type="button"
                          onClick={() => setOutreachForFollowUp(f)}
                          className="shrink-0 rounded-md bg-brand px-2.5 py-1 text-[11px] font-semibold text-white hover:bg-brand-dark"
                        >
                          Outreach
                        </button>
                      </div>
                    );
                  })}
                </div>
              </div>
            ))}
          </div>
        )}
      </CollapsibleSection>

      <div className="text-center">
        <Link href={`/g/${groupId}/members`} className="text-sm font-semibold text-brand hover:underline">
          View all {memberLabel.toLowerCase()}s →
        </Link>
      </div>

      {viewingEntry &&
        createPortal(<ViewOutreachEntryModal entry={viewingEntry} onClose={() => setViewingEntry(null)} />, document.body)}

      {outreachForFollowUp &&
        createPortal(
          <AddOutreachModal
            memberId={outreachForFollowUp.member_id}
            memberName={outreachForFollowUp.member_name}
            memberPhone={outreachForFollowUp.member_phone}
            memberLabel={memberLabel}
            groupId={groupId}
            currentUserName={currentUserName}
            onClose={() => setOutreachForFollowUp(null)}
            onSaved={() => {
              // A new outreach entry was just logged for this member -- the
              // follow-up reminder that prompted it is now handled, so
              // dismiss it automatically instead of leaving it for a
              // separate manual Dismiss click.
              handleDismissFollowUp(outreachForFollowUp.id);
            }}
          />,
          document.body,
        )}

      {showHelp &&
        createPortal(
          <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4" onClick={() => setShowHelp(false)}>
            <div
              className="w-full max-w-md rounded-xl bg-white p-6 shadow-[0_10px_40px_rgba(0,0,0,0.2)] max-h-[85vh] overflow-y-auto"
              onClick={(e) => e.stopPropagation()}
            >
              <div className="flex items-center justify-between border-b-2 border-[#f0f0f0] pb-3 mb-4">
                <h2 className="text-lg font-bold text-brand">What is Actions Needed?</h2>
                <button onClick={() => setShowHelp(false)} className="text-[#999] hover:text-[#333] text-xl leading-none">
                  ×
                </button>
              </div>
              <p className="text-sm text-[#666] mb-2">This section surfaces three kinds of cards, grouped by servant:</p>
              <ul className="list-disc pl-5 text-sm text-[#333] space-y-2 mb-4">
                <li>
                  <strong>Outreach Needed</strong> (amber) — a {memberLabel.toLowerCase()} currently on a
                  consecutive-absence streak at or beyond {proximityEnabled ? "their proximity’s" : "the"} minimum, whose most recent outreach
                  (or lack of any) is older than the outreach-staleness window below. Clears itself automatically the
                  moment they attend again or any servant logs a new outreach entry for them — there&rsquo;s no
                  manual dismiss.
                </li>
                <li>
                  <strong>Newly Assigned</strong> (blue) — a {memberLabel.toLowerCase()} recently assigned to you
                  that hasn&rsquo;t been outreached yet. Clears automatically once you log an outreach entry for
                  them, or you can dismiss it directly.
                </li>
                <li>
                  <strong>Follow-up Due</strong> (mauve) — a reminder you set on a past outreach entry, now due.
                  Dismiss it once you&rsquo;ve followed up.
                </li>
              </ul>
              <p className="text-xs text-[#666] mb-1 font-semibold">
                {proximityEnabled ? "Outreach Needed thresholds, by proximity:" : "Outreach Needed thresholds:"}
              </p>
              <div className="rounded-md bg-[#f5f5f5] p-3 text-xs text-[#333] space-y-1">
                {actionsNeededConfig.map((c) => (
                  <p key={c.proximity}>
                    {proximityEnabled ? (
                      <>
                        <strong>{c.proximity}:</strong> min.
                      </>
                    ) : (
                      <>Min.</>
                    )}{" "}
                    {c.min_presence_count} presence
                    {c.min_presence_count === 1 ? "" : "s"} in the last {actionsNeededLookbackMonths} month
                    {actionsNeededLookbackMonths === 1 ? "" : "s"}, {c.min_absence_weeks} consecutive absence
                    {c.min_absence_weeks === 1 ? "" : "s"}, outreach stale after {c.min_outreach_weeks} week
                    {c.min_outreach_weeks === 1 ? "" : "s"}.
                  </p>
                ))}
              </div>
              <p className="mt-3 text-xs text-[#666]">
                These thresholds are editable by a System Admin on the App Settings screen — this text always reflects the
                current values.
              </p>
            </div>
          </div>,
          document.body,
        )}
    </div>
  );
}

/** Exported for CombinedDashboardOverview's per-cohort panels (the "Load
 * Youth Data for all cohorts" view, REQUIREMENTS.md §6.1 addendum) --
 * same card, shared rather than duplicated. */
export function StatCard({
  label,
  value,
  small,
  icon,
}: {
  label: string;
  value: number | string;
  small?: boolean;
  icon?: React.ReactNode;
}) {
  return (
    <div className="bg-white rounded-xl shadow-[0_4px_20px_rgba(0,0,0,0.06)] border-t-4 border-brand p-4">
      <h3 className="flex items-center gap-1.5 text-[11px] uppercase tracking-wide text-[#666] font-semibold">
        {icon}
        {label}
      </h3>
      <p className={`mt-1 font-bold text-brand ${small ? "text-xl" : "text-3xl"}`}>{value}</p>
    </div>
  );
}
