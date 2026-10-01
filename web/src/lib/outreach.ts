import { createClient } from "@/lib/supabase/server";
import { fetchAllRows } from "@/lib/pagination";
import { todayInZone } from "@/lib/timezone";
import { getAppSettings } from "@/lib/app-settings";

export type OutreachEntry = {
  id: string;
  occurred_at: string;
  type: string | null;
  notes: string | null;
  follow_up_due: string | null;
  servant: { full_name: string } | null;
};

/** All past entries for one member, newest first (REQUIREMENTS.md §6.6's "Prev. Outreach"). */
export async function getMemberOutreach(memberId: string): Promise<OutreachEntry[]> {
  const supabase = await createClient();
  const { data } = await supabase
    .from("outreach_entries")
    .select("id, occurred_at, type, notes, follow_up_due, servant:profiles(full_name)")
    .eq("member_id", memberId)
    .order("occurred_at", { ascending: false });

  return (data ?? []) as unknown as OutreachEntry[];
}

export type OutreachEntryFull = {
  id: string;
  member_id: string;
  member_name: string;
  member_phone: string | null;
  assigned_servant_id: string | null;
  /** The youth's group (for the combined view's cohort filter). */
  member_group_id: string | null;
  servant_id: string;
  servant_name: string;
  occurred_at: string;
  type: string | null;
  notes: string | null;
  follow_up_due: string | null;
};

/** Full Outreach tab (§6.6) -- every entry for this group's members, newest
 * first. Search/filter (Member, Servant, Date range, My Assigned List)
 * happens client-side on this fetched set, same architecture as the Member
 * List. Filters by the joined member's group_id directly (one round trip)
 * rather than fetching member ids first and filtering in a second query. */
export async function getOutreachEntries(groupId: string | string[]): Promise<OutreachEntryFull[]> {
  const supabase = await createClient();

  // Paged (lib/pagination.ts): a cohort's outreach history passes
  // PostgREST's 1000-row cap over time, and this used to silently drop the
  // oldest entries past that point.
  const data = await fetchAllRows((from, to) => {
    let query = supabase
      .from("outreach_entries")
      .select(
        "id, member_id, servant_id, occurred_at, type, notes, follow_up_due, member:members!inner(full_name, phone, assigned_servant_id, group_id), servant:profiles(full_name)",
      )
      .order("occurred_at", { ascending: false })
      .order("id")
      .range(from, to);
    query = Array.isArray(groupId) ? query.in("member.group_id", groupId) : query.eq("member.group_id", groupId);
    return query;
  });

  return (data as unknown as {
    id: string;
    member_id: string;
    servant_id: string;
    occurred_at: string;
    type: string | null;
    notes: string | null;
    follow_up_due: string | null;
    member: { full_name: string; phone: string | null; assigned_servant_id: string | null; group_id: string } | null;
    servant: { full_name: string } | null;
  }[]).map((r) => ({
    id: r.id,
    member_id: r.member_id,
    member_name: r.member?.full_name ?? "Unknown",
    member_phone: r.member?.phone ?? null,
    assigned_servant_id: r.member?.assigned_servant_id ?? null,
    member_group_id: r.member?.group_id ?? null,
    servant_id: r.servant_id,
    servant_name: r.servant?.full_name ?? "Unknown",
    occurred_at: r.occurred_at,
    type: r.type,
    notes: r.notes,
    follow_up_due: r.follow_up_due,
  }));
}

export type FollowUpDueEntry = OutreachEntryFull & { member_photo_path: string | null };

/** REQUIREMENTS.md §6.3/§6.6/§7.1 -- open follow-up reminders (`follow_up_due`
 * on or before today, not yet dismissed) for one group, surfaced under the
 * *entry's own creator* on the Dashboard's Actions Needed section -- the
 * servant who set the reminder is the one being reminded, regardless of who
 * the member is currently assigned to. Carries every field EditOutreachEntryModal
 * needs so the Dashboard's "view original entry" link can open it without a
 * second fetch. */
export async function getFollowUpsDue(groupId: string | string[]): Promise<FollowUpDueEntry[]> {
  const [supabase, settings] = await Promise.all([createClient(), getAppSettings()]);
  const today = todayInZone(settings.timezone);

  let query = supabase
    .from("outreach_entries")
    .select(
      "id, member_id, servant_id, occurred_at, type, notes, follow_up_due, member:members!inner(full_name, phone, photo_path, assigned_servant_id, group_id), servant:profiles(full_name)",
    );
  query = Array.isArray(groupId) ? query.in("member.group_id", groupId) : query.eq("member.group_id", groupId);
  const { data } = await query
    .not("follow_up_due", "is", null)
    .is("follow_up_dismissed_at", null)
    .lte("follow_up_due", today)
    .order("follow_up_due", { ascending: true });

  return ((data ?? []) as unknown as {
    id: string;
    member_id: string;
    servant_id: string;
    occurred_at: string;
    type: string | null;
    notes: string | null;
    follow_up_due: string | null;
    member: { full_name: string; phone: string | null; photo_path: string | null; assigned_servant_id: string | null; group_id: string } | null;
    servant: { full_name: string } | null;
  }[]).map((r) => ({
    id: r.id,
    member_id: r.member_id,
    member_name: r.member?.full_name ?? "Unknown",
    member_phone: r.member?.phone ?? null,
    member_photo_path: r.member?.photo_path ?? null,
    assigned_servant_id: r.member?.assigned_servant_id ?? null,
    member_group_id: r.member?.group_id ?? null,
    servant_id: r.servant_id,
    servant_name: r.servant?.full_name ?? "Unknown",
    occurred_at: r.occurred_at,
    type: r.type,
    notes: r.notes,
    follow_up_due: r.follow_up_due,
  }));
}
