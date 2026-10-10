"use client";

import { useEffect, useRef, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { BusyLabel } from "@/components/PendingButton";
import { editMessageAction, markReadAction, replyAction, setTaskDoneAction } from "@/app/messages/actions";
import { dueLabel, stampLabel, type ConversationDetail, type MessageItem } from "@/lib/messages";

const CARD = "rounded-xl bg-white shadow-[0_4px_20px_rgba(0,0,0,0.06)] p-4";
const INPUT =
  "w-full rounded-md border border-[#ddd] px-3 py-2 text-base focus:border-brand focus:outline-none focus:ring-2 focus:ring-brand/10";
const PRIMARY =
  "rounded-md bg-brand px-4 py-2 text-sm font-semibold text-white hover:bg-brand-dark disabled:opacity-60 shadow-[0_2px_4px_rgba(0,0,0,0.15)]";
const SECONDARY = "rounded-md border border-[#ddd] bg-white px-3 py-1.5 text-xs font-semibold text-[#333] hover:bg-[#f5f5f5] disabled:opacity-60";

type Busy = "reply" | "done" | "reopen" | `edit:${string}` | null;

/** A conversation (migration 0102). Replies, the 15-minute edit, and a
 * task's "Mark as done" (with a note) / "Reopen" for the people given it;
 * the sender (and anyone reading the whole ministry's) sees each person's
 * status and note. Looks for new replies when the app comes back to the
 * front. */
export function ConversationView({ conv, timeZone, today }: { conv: ConversationDetail; timeZone: string; today: string }) {
  const router = useRouter();
  const [reply, setReply] = useState("");
  const [note, setNote] = useState("");
  const [editing, setEditing] = useState<{ id: string; body: string } | null>(null);
  const [busy, setBusy] = useState<Busy>(null);
  const [error, setError] = useState<string | null>(null);
  const working = useRef(false);
  const messages = conv.messages ?? [];
  const me = conv.members.find((m) => m.me);
  const sender = conv.members.find((m) => m.is_sender);
  const recipients = conv.members.filter((m) => !m.is_sender);
  const gotTask = conv.is_task && conv.member && !conv.i_sent;

  // Opened: no longer unread. Again whenever a new message arrives here.
  useEffect(() => {
    if (conv.member) void markReadAction(conv.id);
  }, [conv.id, conv.member, messages.length]);

  // Back to the front (another app, another tab): look for new replies.
  useEffect(() => {
    const look = () => {
      if (document.visibilityState === "visible") router.refresh();
    };
    document.addEventListener("visibilitychange", look);
    return () => document.removeEventListener("visibilitychange", look);
  }, [router]);

  async function run(kind: Exclude<Busy, null>, task: () => Promise<{ error: string | null }>, after?: () => void) {
    if (working.current) return;
    working.current = true;
    setBusy(kind);
    setError(null);
    try {
      const res = await task();
      if (res.error) {
        setError(res.error);
        return;
      }
      after?.();
      router.refresh();
    } catch {
      setError("Something went wrong. Please try again.");
    } finally {
      working.current = false;
      setBusy(null);
    }
  }

  const statusRows =
    conv.batch && conv.batch.length > 1
      ? conv.batch.map((b) => ({ key: b.conversation_id, name: b.name, done_at: b.done_at, done_note: b.done_note, href: b.current ? null : `/messages/${b.conversation_id}`, current: b.current }))
      : recipients.map((m) => ({ key: m.user_id, name: m.name, done_at: m.done_at, done_note: m.done_note, href: null, current: false }));
  const doneCount = statusRows.filter((r) => r.done_at).length;
  const overdue = conv.due_on && conv.due_on < today;

  return (
    <>
      <div className={CARD}>
        <h2 className="text-base font-bold text-[#333]">{conv.subject}</h2>
        <p className="mt-0.5 text-xs text-[#666]">
          {conv.i_sent ? (
            <>To {conv.batch && conv.batch.length > 1 ? `${conv.batch.length} people, each privately` : recipients.map((r) => r.name).join(", ")}</>
          ) : (
            <>
              From {sender?.name ?? "—"}
              {conv.mode === "group" && <> to {recipients.map((r) => (r.me ? "you" : r.name)).join(", ")}</>}
            </>
          )}
        </p>
        {conv.link_url && (
          <a
            href={conv.link_url}
            target="_blank"
            rel="noopener noreferrer"
            className="mt-1 inline-block text-sm font-semibold text-brand underline"
          >
            Open link
          </a>
        )}
        {conv.is_task && (
          <div className="mt-2 flex flex-wrap items-center gap-1.5 text-[11px] font-semibold">
            <span className="rounded bg-[#e8f0fe] px-1.5 py-0.5 text-[#1a56db]">Task</span>
            {conv.due_on ? (
              <span className={`rounded px-1.5 py-0.5 ${overdue ? "bg-[#f8d7da] text-[#721c24]" : "bg-[#f0f0f0] text-[#555]"}`}>
                Due {dueLabel(conv.due_on)}
              </span>
            ) : (
              <span className="rounded bg-[#f0f0f0] px-1.5 py-0.5 text-[#555]">No due date</span>
            )}
          </div>
        )}
        {!conv.member && (
          <p className="mt-2 rounded-md bg-[#f0f4f8] px-3 py-2 text-xs text-[#333]">
            You&rsquo;re not in this conversation; your role lets you read it. Only the people in it can write here.
          </p>
        )}
      </div>

      {/* The task, for the person given it. */}
      {gotTask && me && (
        <div className={CARD}>
          {me.done_at ? (
            <>
              <p className="text-sm text-[#333]">
                <span className="mr-2 rounded bg-[#d4edda] px-1.5 py-0.5 text-[11px] font-semibold uppercase text-[#155724]">Done</span>
                {stampLabel(me.done_at, timeZone)}
              </p>
              {me.done_note && <p className="mt-1 whitespace-pre-wrap text-sm text-[#555]">{me.done_note}</p>}
              <button
                type="button"
                className={`${SECONDARY} mt-3`}
                disabled={!!busy}
                onClick={() => run("reopen", () => setTaskDoneAction(conv.id, false, ""))}
              >
                <BusyLabel busy={busy === "reopen"} busyText="Reopening…">
                  Reopen
                </BusyLabel>
              </button>
            </>
          ) : (
            <>
              <label className="block text-xs font-semibold text-[#666] mb-1" htmlFor="done-note">
                Note for {sender?.name ?? "them"} (optional)
              </label>
              <textarea
                id="done-note"
                rows={2}
                maxLength={1000}
                value={note}
                onChange={(e) => setNote(e.target.value)}
                className={INPUT}
                placeholder="e.g. Called all of them; two are away this week."
              />
              <button
                type="button"
                className={`${PRIMARY} mt-2 w-full`}
                disabled={!!busy}
                onClick={() => run("done", () => setTaskDoneAction(conv.id, true, note), () => setNote(""))}
              >
                <BusyLabel busy={busy === "done"} busyText="Saving…">
                  Mark as done
                </BusyLabel>
              </button>
            </>
          )}
        </div>
      )}

      {/* Everyone's status, for the sender (and the whole-ministry view). */}
      {conv.is_task && !gotTask && statusRows.length > 0 && (
        <div className={CARD}>
          <p className="text-sm font-semibold text-[#333]">
            {doneCount} of {statusRows.length} done
          </p>
          <ul className="mt-2 divide-y divide-[#eee]">
            {statusRows.map((r) => (
              <li key={r.key} className={`py-2 ${r.current ? "bg-brand/5 -mx-2 px-2 rounded" : ""}`}>
                <div className="flex items-center justify-between gap-2 text-sm">
                  {r.href ? (
                    <Link href={r.href} className="font-semibold text-brand hover:underline">
                      {r.name}
                    </Link>
                  ) : (
                    <span className="font-semibold text-[#333]">{r.name}</span>
                  )}
                  <span
                    className={`shrink-0 rounded px-1.5 py-0.5 text-[11px] font-semibold ${
                      r.done_at ? "bg-[#d4edda] text-[#155724]" : "bg-[#fff8e1] text-[#5c4400]"
                    }`}
                  >
                    {r.done_at ? `Done ${stampLabel(r.done_at, timeZone)}` : "To do"}
                  </span>
                </div>
                {r.done_note && <p className="mt-0.5 whitespace-pre-wrap text-xs text-[#555]">{r.done_note}</p>}
              </li>
            ))}
          </ul>
          {conv.batch && conv.batch.length > 1 && (
            <p className="mt-2 text-[11px] text-[#888]">Each person replies to you privately. Tap a name to open their conversation.</p>
          )}
        </div>
      )}

      <div className="space-y-2">
        {conv.batch && conv.batch.length > 1 && (
          <p className="text-center text-xs text-[#888]">
            Conversation with {conv.batch.find((b) => b.current)?.name ?? "—"}
          </p>
        )}
        {messages.map((m) => (
          <Bubble
            key={m.id}
            m={m}
            timeZone={timeZone}
            editing={editing?.id === m.id ? editing.body : null}
            busy={busy === `edit:${m.id}`}
            disabled={!!busy}
            onEdit={() => setEditing({ id: m.id, body: m.body })}
            onChange={(body) => setEditing({ id: m.id, body })}
            onCancel={() => setEditing(null)}
            onSave={() =>
              editing && run(`edit:${m.id}`, () => editMessageAction(m.id, editing.body), () => setEditing(null))
            }
          />
        ))}
      </div>

      {error && <p className="rounded-md bg-[#f8d7da] px-3 py-2 text-sm text-[#721c24]">{error}</p>}

      {conv.member && (
        <div className={CARD}>
          <textarea
            rows={3}
            maxLength={4000}
            value={reply}
            onChange={(e) => setReply(e.target.value)}
            className={INPUT}
            placeholder={conv.mode === "group" ? "Reply to everyone…" : "Write a reply…"}
            aria-label="Reply"
          />
          <button
            type="button"
            className={`${PRIMARY} mt-2 w-full`}
            disabled={!!busy || !reply.trim()}
            onClick={() => run("reply", () => replyAction(conv.id, reply), () => setReply(""))}
          >
            <BusyLabel busy={busy === "reply"} busyText="Sending…">
              Send
            </BusyLabel>
          </button>
        </div>
      )}
    </>
  );
}

function Bubble({
  m,
  timeZone,
  editing,
  busy,
  disabled,
  onEdit,
  onChange,
  onCancel,
  onSave,
}: {
  m: MessageItem;
  timeZone: string;
  editing: string | null;
  busy: boolean;
  disabled: boolean;
  onEdit: () => void;
  onChange: (body: string) => void;
  onCancel: () => void;
  onSave: () => void;
}) {
  return (
    <div className={`flex ${m.mine ? "justify-end" : "justify-start"}`}>
      <div
        className={`max-w-[85%] rounded-2xl px-3.5 py-2 shadow-[0_1px_3px_rgba(0,0,0,0.08)] ${
          m.mine ? "bg-brand text-white rounded-br-sm" : "bg-white text-[#333] rounded-bl-sm"
        }`}
      >
        <p className={`text-[11px] ${m.mine ? "text-white/80" : "text-[#888]"}`}>
          {m.mine ? "You" : m.author} · {stampLabel(m.created_at, timeZone)}
          {m.edited_at && " · edited"}
        </p>
        {editing !== null ? (
          <div className="mt-1">
            <textarea
              rows={3}
              maxLength={4000}
              value={editing}
              onChange={(e) => onChange(e.target.value)}
              className="w-full rounded-md border border-white/40 bg-white px-2 py-1.5 text-base text-[#333] focus:outline-none"
              aria-label="Edit message"
            />
            <div className="mt-1 flex justify-end gap-2">
              <button type="button" onClick={onCancel} disabled={disabled} className="text-xs font-semibold text-white/90 hover:underline">
                Cancel
              </button>
              <button
                type="button"
                onClick={onSave}
                disabled={disabled || !editing.trim()}
                className="rounded bg-white px-2.5 py-1 text-xs font-semibold text-brand disabled:opacity-60"
              >
                <BusyLabel busy={busy} busyText="Saving…">
                  Save
                </BusyLabel>
              </button>
            </div>
          </div>
        ) : (
          <>
            <p className="mt-0.5 whitespace-pre-wrap break-words text-sm">{m.body}</p>
            {m.can_edit && (
              <button type="button" onClick={onEdit} disabled={disabled} className="mt-1 text-[11px] font-semibold text-white/90 hover:underline">
                Edit
              </button>
            )}
          </>
        )}
      </div>
    </div>
  );
}
