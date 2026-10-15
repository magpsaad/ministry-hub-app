"use server";

import { createClient } from "@/lib/supabase/server";
import { REACTION_EMOJIS, type ReactionKind, type ReactionRow } from "@/lib/reactions";

const UUID = /^[0-9a-f-]{36}$/i;

/** Reactions (migration 0117) for several announcements or messages at
 * once -- only the ones this person can see. */
export async function getReactionsAction(kind: ReactionKind, ids: string[]): Promise<ReactionRow[]> {
  if (kind !== "announcement" && kind !== "message") return [];
  const clean = ids.filter((id) => UUID.test(id)).slice(0, 200);
  if (clean.length === 0) return [];
  const supabase = await createClient();
  const { data } = await supabase.rpc("item_reactions", { p_kind: kind, p_ids: clean });
  return (data ?? []) as ReactionRow[];
}

/** Set, replace or (null) remove my reaction. */
export async function setReactionAction(kind: ReactionKind, id: string, emoji: string | null) {
  if ((kind !== "announcement" && kind !== "message") || !UUID.test(id)) return { error: "Not found" };
  if (emoji !== null && !(REACTION_EMOJIS as readonly string[]).includes(emoji)) return { error: "Choose one of the reactions shown" };
  const supabase = await createClient();
  const { error } = await supabase.rpc("set_reaction", { p_kind: kind, p_id: id, p_emoji: emoji });
  return { error: error?.message ?? null };
}
