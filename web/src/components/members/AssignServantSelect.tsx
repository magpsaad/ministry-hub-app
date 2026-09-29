"use client";

import { useRouter } from "next/navigation";
import { useTransition } from "react";
import type { ServantOption } from "@/lib/servants";
import { assignServantAction } from "@/app/g/[groupId]/members/actions";

/** REQUIREMENTS.md §6.3 -- the New Registrations quick-assign dropdown hard-
 * filters to matching-gender servants (confirmed against the current app's
 * actual behavior for this specific widget -- unlike the Member Detail
 * modal's assignment dropdown, which only soft-sorts by gender). A servant
 * with no gender on file (a data gap, since gender is normally a required
 * intake field) still shows up in every list rather than being silently and
 * permanently excluded. */
export function AssignServantSelect({
  memberId,
  groupId,
  memberGender,
  servants,
}: {
  memberId: string;
  groupId: string;
  memberGender: string | null;
  servants: ServantOption[];
}) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();

  const matching = servants
    .filter((s) => !memberGender || !s.gender || s.gender === memberGender)
    .sort((a, b) => a.full_name.localeCompare(b.full_name));

  return (
    <select
      defaultValue=""
      disabled={pending}
      onChange={(e) => {
        const select = e.target;
        if (!select.value) return;
        startTransition(async () => {
          const result = await assignServantAction(memberId, groupId, select.value);
          if (result.error) {
            // Owner-reported (QA R-1): a refused assignment used to look
            // like it did nothing. Say why, and put the dropdown back.
            select.value = "";
            alert(result.error);
            return;
          }
          router.refresh();
        });
      }}
      // Owner-reported: shortening the visible label alone didn't shrink
      // this control -- a native <select>'s rendered box width isn't
      // reliably driven by its currently-shown option on every browser;
      // several (WebKit/Firefox in particular) size it to fit the WIDEST
      // option in the whole list instead (here, a full servant name plus
      // "(has N)"), so the box stayed wide regardless of the short
      // placeholder text. An explicit width overrides that intrinsic
      // sizing outright. shrink-0 keeps it at that width so the sibling
      // info column (not this) does any shrinking on a narrow screen.
      className="shrink-0 w-[76px] truncate rounded-md bg-brand px-2 py-1.5 text-xs font-semibold text-white hover:bg-brand-dark focus:outline-none disabled:opacity-60"
    >
      <option value="" disabled>
        {pending ? "Assigning…" : "Assign"}
      </option>
      {matching.map((s) => (
        <option key={s.id} value={s.id}>
          {s.full_name} (has {s.caseload})
        </option>
      ))}
    </select>
  );
}
