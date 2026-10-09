"use server";

import { after } from "next/server";
import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import { dispatchPush } from "@/lib/push";
import { roleWords } from "@/lib/role-labels-server";
import type { AnnouncementRole, CurrentAnnouncement } from "@/lib/announcements";

/** Announcements (migration 0099). The database decides who may post what
 * (post_announcement); these only pass the form along. */

export type AnnouncementInput = {
  id: string | null;
  title: string;
  body: string;
  link: string;
  importance: "normal" | "important";
  /** Empty = Everyone (Admins / GCs only). */
  roles: AnnouncementRole[];
  groups: string[];
  includeYouth: boolean;
  startsOn: string;
  endsOn: string;
  /** Church Admin, on the console only. */
  ministries?: string[];
};

export async function postAnnouncementAction(input: AnnouncementInput): Promise<{ error: string | null }> {
  if (!input.title.trim() || !input.body.trim()) return { error: "Add a title and a message." };
  if (!input.endsOn) return { error: "Choose until when it shows." };
  const supabase = await createClient();
  const { error } = await supabase.rpc("post_announcement", {
    p_id: input.id,
    p_title: input.title,
    p_body: input.body,
    p_link: input.link,
    p_importance: input.importance,
    p_roles: input.roles,
    p_groups: input.groups,
    p_include_youth: input.includeYouth,
    p_starts_on: input.startsOn || null,
    p_ends_on: input.endsOn,
    p_ministries: input.ministries ?? null,
  });
  if (error) return { error: await roleWords(error.message) };
  // Phone notifications for one that's showing already go out right away.
  after(dispatchPush);
  revalidatePath("/announcements");
  revalidatePath("/console/announcements");
  return { error: null };
}

export async function takeDownAnnouncementAction(id: string): Promise<{ error: string | null }> {
  const supabase = await createClient();
  const { error } = await supabase.rpc("take_down_announcement", { p_id: id });
  if (error) return { error: await roleWords(error.message) };
  revalidatePath("/announcements");
  revalidatePath("/console/announcements");
  return { error: null };
}

/** The form's "Reaches about N people". */
export async function audienceCountAction(roles: AnnouncementRole[], groups: string[], youth: boolean): Promise<number | null> {
  const supabase = await createClient();
  const { data, error } = await supabase.rpc("announcement_audience_count", { p_roles: roles, p_groups: groups, p_youth: youth });
  return error ? null : (data as number);
}

export async function readListAction(
  id: string,
): Promise<{ error: string | null; rows: { full_name: string; acknowledged_at: string | null }[] }> {
  const supabase = await createClient();
  const { data, error } = await supabase.rpc("announcement_read_list", { p_id: id });
  if (error) return { error: await roleWords(error.message), rows: [] };
  return { error: null, rows: (data ?? []) as { full_name: string; acknowledged_at: string | null }[] };
}

/** 'seen' (opened the page), 'dismiss' (banner X), 'ack' (Got it). */
export async function markAnnouncementAction(id: string, what: "seen" | "dismiss" | "ack"): Promise<{ error: string | null }> {
  const supabase = await createClient();
  const { error } = await supabase.rpc("mark_announcement", { p_id: id, p_what: what });
  return { error: error ? "Couldn't save that. Please try again." : null };
}

/** Banners (Normal) and pop-ups (Important) for me, right now. */
export async function currentAnnouncementsAction(): Promise<CurrentAnnouncement[]> {
  const supabase = await createClient();
  const { data } = await supabase.rpc("my_current_announcements");
  return (data ?? []) as CurrentAnnouncement[];
}
