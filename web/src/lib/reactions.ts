/** Emoji reactions (owner-approved 15 Oct 2026, migration 0117): one per
 * person per announcement or message, from this fixed set. */
export const REACTION_EMOJIS = ["👍", "❤️", "🙏", "😂", "😮", "😢"] as const;

export type ReactionKind = "announcement" | "message";

/** One emoji on one item: how many, whether one is mine, and who. */
export type ReactionRow = { item_id: string; emoji: string; n: number; mine: boolean; names: string[] };
