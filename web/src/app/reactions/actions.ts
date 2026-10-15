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

/** Set, replace or (null) remove my reaction, and hand back the item's
 * reactions as they now are -- one trip instead of two (owner-reported
 * 15 Oct 2026: adding one felt slow). */
export async function setReactionAction(
  kind: ReactionKind,
  id: string,
  emoji: string | null,
): Promise<{ error: string | null; rows: ReactionRow[] | null }> {
  if ((kind !== "announcement" && kind !== "message") || !UUID.test(id)) return { error: "Not found", rows: null };
  if (emoji !== null && !(REACTION_EMOJIS as readonly string[]).includes(emoji)) {
    return { error: "Choose one of the reactions shown", rows: null };
  }
  const supabase = await createClient();
  const { error } = await supabase.rpc("set_reaction", { p_kind: kind, p_id: id, p_emoji: emoji });
  if (error) return { error: error.message, rows: null };
  const { data } = await supabase.rpc("item_reactions", { p_kind: kind, p_ids: [id] });
  return { error: null, rows: (data ?? []) as ReactionRow[] };
}
