"use client";

import { useEffect, useRef, useState } from "react";
import { getReactionsAction, setReactionAction } from "@/app/reactions/actions";
import { REACTION_EMOJIS, type ReactionKind, type ReactionRow } from "@/lib/reactions";
import { SmilePlusIcon } from "@/components/icons";

/** All the reaction rows on one screen load together: items that ask in the
 * same moment share one request. */
const queues = new Map<ReactionKind, { ids: Set<string>; waiters: ((rows: ReactionRow[]) => void)[] }>();

function loadReactions(kind: ReactionKind, id: string): Promise<ReactionRow[]> {
  return new Promise((resolve) => {
    let q = queues.get(kind);
    if (!q) {
      q = { ids: new Set(), waiters: [] };
      queues.set(kind, q);
      window.setTimeout(async () => {
        const batch = queues.get(kind)!;
        queues.delete(kind);
        let rows: ReactionRow[] = [];
        try {
          rows = await getReactionsAction(kind, Array.from(batch.ids));
        } catch {
          // Shown without reactions; they appear on the next visit.
        }
        batch.waiters.forEach((w) => w(rows));
      }, 0);
    }
    q.ids.add(id);
    q.waiters.push((rows) => resolve(rows.filter((r) => r.item_id === id)));
  });
}

/** Owner-approved (15 Oct 2026, migration 0117): emoji reactions under an
 * announcement or a message. One per person, like WhatsApp -- another emoji
 * replaces mine, the same one again removes it. The smiley opens the six
 * choices and who has reacted. `readOnly`: shown but can't be added to
 * (someone only overseeing a conversation). */
export function Reactions({
  kind,
  itemId,
  readOnly = false,
  align = "start",
}: {
  kind: ReactionKind;
  itemId: string;
  readOnly?: boolean;
  align?: "start" | "end";
}) {
  const [rows, setRows] = useState<ReactionRow[]>([]);
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const box = useRef<HTMLDivElement>(null);

  useEffect(() => {
    let cancelled = false;
    void loadReactions(kind, itemId).then((r) => {
      if (!cancelled) setRows(r);
    });
    return () => {
      cancelled = true;
    };
  }, [kind, itemId]);

  // Tapping anywhere else closes the picker.
  useEffect(() => {
    if (!open) return;
    function close(e: PointerEvent) {
      if (box.current && !box.current.contains(e.target as Node)) setOpen(false);
    }
    document.addEventListener("pointerdown", close);
    return () => document.removeEventListener("pointerdown", close);
  }, [open]);

  const mine = rows.find((r) => r.mine)?.emoji ?? null;

  async function choose(emoji: string) {
    if (busy || readOnly) return;
    const next = mine === emoji ? null : emoji;
    setBusy(true);
    setError(null);
    const res = await setReactionAction(kind, itemId, next);
    if (res.error) {
      setError(res.error);
    } else {
      setRows(await getReactionsAction(kind, [itemId]));
      setOpen(false);
    }
    setBusy(false);
  }

  if (rows.length === 0 && readOnly) return null;

  return (
    <div ref={box} className={`relative mt-1.5 flex flex-wrap items-center gap-1 ${align === "end" ? "justify-end" : ""}`}>
      {rows.map((r) => (
        <button
          key={r.emoji}
          type="button"
          onClick={() => choose(r.emoji)}
          disabled={busy || readOnly}
          title={r.names.join(", ")}
          aria-label={`${r.emoji} ${r.n}: ${r.names.join(", ")}`}
          className={`inline-flex items-center gap-1 rounded-full border px-2 py-0.5 text-xs disabled:cursor-default ${
            r.mine ? "border-brand bg-brand/10 font-semibold text-brand" : "border-[#ddd] bg-white text-[#555]"
          }`}
        >
          <span>{r.emoji}</span>
          <span>{r.n}</span>
        </button>
      ))}
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        aria-label={readOnly ? "Who reacted" : "React"}
        aria-expanded={open}
        className="inline-flex h-6 w-7 items-center justify-center rounded-full border border-[#ddd] bg-white text-[#888] hover:text-brand"
      >
        <SmilePlusIcon className="h-4 w-4" />
      </button>
      {open && (
        <div
          className={`absolute top-full z-30 mt-1 w-64 max-w-[85vw] rounded-xl border border-[#eee] bg-white p-2 shadow-[0_6px_24px_rgba(0,0,0,0.15)] ${
            align === "end" ? "right-0" : "left-0"
          }`}
        >
          {!readOnly && (
            <div className="flex justify-between">
              {REACTION_EMOJIS.map((e) => (
                <button
                  key={e}
                  type="button"
                  onClick={() => choose(e)}
                  disabled={busy}
                  aria-label={mine === e ? `Remove ${e}` : `React ${e}`}
                  className={`h-9 w-9 rounded-full text-xl disabled:opacity-50 ${mine === e ? "bg-brand/15" : "hover:bg-[#f5f5f5]"}`}
                >
                  {e}
                </button>
              ))}
            </div>
          )}
          {error && <p className="mt-1 px-1 text-xs text-[#dc3545]">{error}</p>}
          {rows.length > 0 ? (
            <ul className={`max-h-40 overflow-y-auto px-1 text-xs text-[#555] ${readOnly ? "" : "mt-2 border-t border-[#f0f0f0] pt-2"}`}>
              {rows.map((r) => (
                <li key={r.emoji} className="py-0.5">
                  <span className="mr-1">{r.emoji}</span>
                  {r.names.join(", ")}
                </li>
              ))}
            </ul>
          ) : (
            <p className="mt-2 border-t border-[#f0f0f0] px-1 pt-2 text-xs text-[#888]">No reactions yet.</p>
          )}
        </div>
      )}
    </div>
  );
}
