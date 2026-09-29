"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import type { MemberDetail } from "@/lib/members";
import type { University } from "@/lib/universities";
import type { ServantOption } from "@/lib/servants";
import type { GroupSummary } from "@/lib/groups";
import { getMemberAction } from "@/app/g/[groupId]/members/data-actions";
import { MemberDetailModal } from "./MemberDetailModal";
import { useMemberOverrides } from "./MemberOverrides";

/** Wraps any trigger element (a name, a card, ...) so clicking it opens the
 * Member Detail modal -- reused from the Member List grid, Dashboard's
 * Birthdays and New Registrations sections, and anywhere else a member
 * needs to be one click away. */
export function MemberDetailLink({
  memberId,
  groupId,
  groups,
  groupLabel,
  universities,
  universityLabel,
  programLabel,
  servants,
  memberLabel,
  canDelete,
  canEdit = true,
  currentUserName,
  className,
  children,
}: {
  memberId: string;
  groupId: string;
  groups?: GroupSummary[];
  groupLabel?: string;
  universities: University[];
  universityLabel: string;
  programLabel: string;
  servants: ServantOption[];
  memberLabel: string;
  canDelete: boolean;
  /** Owner-reported (Read-Only bug follow-up): defaults to true for call
   * sites (Dashboard's Birthdays/New Registrations) that haven't been
   * threaded through with a per-member answer yet -- only the Members list
   * currently computes this per-cohort. */
  canEdit?: boolean;
  currentUserName: string;
  className?: string;
  children: React.ReactNode;
}) {
  const router = useRouter();
  const overrides = useMemberOverrides();
  const [detail, setDetail] = useState<MemberDetail | null>(null);
  const [loading, setLoading] = useState(false);

  async function open() {
    setLoading(true);
    const d = await getMemberAction(memberId);
    setLoading(false);
    if (d) setDetail(d);
  }

  return (
    <>
      <button type="button" onClick={open} disabled={loading} className={className}>
        {children}
      </button>
      {detail && (
        <MemberDetailModal
          member={detail}
          groupId={groupId}
          groups={groups ?? []}
          groupLabel={groupLabel ?? "Group"}
          universities={universities}
          universityLabel={universityLabel}
          programLabel={programLabel}
          servants={servants}
          memberLabel={memberLabel}
          canDelete={canDelete}
          canEdit={canEdit}
          currentUserName={currentUserName}
          onClose={() => setDetail(null)}
          onSaved={(patch) => {
            if (patch) overrides?.apply(memberId, patch);
            router.refresh();
          }}
        />
      )}
    </>
  );
}
