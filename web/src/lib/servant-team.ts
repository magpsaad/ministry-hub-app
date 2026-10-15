import { createClient } from "@/lib/supabase/server";

/** Owner-requested (15 Oct 2026, migration 0116) -- the Dashboard's "My
 * Servants Team": the people a Coordinator looks after (their groups'
 * Servants and Coordinators), or for a General Coordinator everyone, one
 * row per person per group. Empty for anyone else. */
export type ServantTeamRow = {
  person_id: string;
  full_name: string;
  gender: string | null;
  photo_path: string | null;
  phone: string | null;
  /** null = not assigned to a group yet */
  group_id: string | null;
  group_name: string | null;
  group_order: number | null;
  is_servant: boolean;
  is_coordinator: boolean;
  /** Service days in a row they've missed (since they joined) */
  absent_weeks: number;
  present_last: boolean;
  /** Had joined by the last service day, so counts toward "n of N" */
  counted_last: boolean;
  last_service: string | null;
  last_seen_at: string | null;
  /** Hasn't opened the app for the ministry's number of days */
  quiet: boolean;
  birthday_month: number | null;
  birthday_day: number | null;
  /** Days from today to their birthday, within the birthday window; null outside it */
  birthday_offset: number | null;
};

export async function getMyServantTeam(): Promise<ServantTeamRow[]> {
  const supabase = await createClient();
  const { data, error } = await supabase.rpc("my_servant_team");
  if (error) return [];
  return (data ?? []) as ServantTeamRow[];
}
