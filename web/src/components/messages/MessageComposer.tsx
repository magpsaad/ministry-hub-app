"use client";

import { useMemo, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { BusyLabel } from "@/components/PendingButton";
import { useRoleLabels } from "@/components/RoleLabelsProvider";
import { sendMessageAction } from "@/app/messages/actions";
import type { RoleLabels } from "@/lib/role-labels";
import type { PersonOption } from "@/lib/messages";
import { startNavigationSpinner } from "@/components/NavigationSpinner";

const CARD = "rounded-xl bg-white shadow-[0_4px_20px_rgba(0,0,0,0.06)] p-4";
const INPUT =
  "w-full rounded-md border border-[#ddd] px-3 py-2 text-base focus:border-brand focus:outline-none focus:ring-2 focus:ring-brand/10";
const LABEL = "block text-xs font-semibold text-[#666] mb-1";
const PRIMARY =
  "rounded-md bg-brand px-4 py-2 text-sm font-semibold text-white hover:bg-brand-dark disabled:opacity-60 shadow-[0_2px_4px_rgba(0,0,0,0.15)]";

function chipClass(on: boolean) {
  return `rounded-full border px-3 py-1 text-xs font-semibold transition-colors ${
    on ? "border-brand bg-brand/10 text-brand" : "border-[#ddd] bg-white text-[#555] hover:bg-[#f5f5f5]"
  }`;
}

/** A person's main role, in this ministry's words. */
function roleLabel(roles: string, L: RoleLabels): string {
  const r = roles.split(",");
  if (r.includes("admin")) return "System Admin";
  if (r.includes("general_coordinator")) return L.generalCoordinator;
  if (r.includes("sub_coordinator")) return L.coordinator;
  if (r.includes("servant")) return L.servant;
  return "Read-only";
}

/** New message (migration 0102): pick people and/or whole classes (their
 * Servants), then -- for more than one person -- whether each replies
 * privately or it's one group conversation. "This is a task" adds an
 * optional due date; the people given it can mark it done. */
export function MessageComposer({
  people,
  classes,
  today,
  initialTo,
}: {
  people: PersonOption[];
  classes: { id: string; name: string }[];
  today: string;
  initialTo: string[];
}) {
  const L = useRoleLabels();
  const router = useRouter();
  const [to, setTo] = useState<string[]>(initialTo);
  const [classIds, setClassIds] = useState<string[]>([]);
  const [search, setSearch] = useState("");
  const [mode, setMode] = useState<"private" | "group">("private");
  const [subject, setSubject] = useState("");
  const [body, setBody] = useState("");
  const [link, setLink] = useState("");
  const [isTask, setIsTask] = useState(false);
  const [dueOn, setDueOn] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const working = useRef(false);

  const byId = useMemo(() => new Map(people.map((p) => [p.user_id, p])), [people]);
  const recipients = useMemo(() => {
    const s = new Set(to);
    for (const p of people) if (p.servant_of.some((g) => classIds.includes(g))) s.add(p.user_id);
    return s;
  }, [to, classIds, people]);
  const classCount = (id: string) => people.filter((p) => p.servant_of.includes(id)).length;
  const q = search.trim().toLowerCase();
  const matches = q ? people.filter((p) => !to.includes(p.user_id) && p.full_name.toLowerCase().includes(q)).slice(0, 8) : [];
  const several = recipients.size > 1;

  function addPerson(id: string) {
    setTo((t) => (t.includes(id) ? t : [...t, id]));
    setSearch("");
  }

  async function send() {
    if (working.current) return;
    working.current = true;
    setBusy(true);
    setError(null);
    try {
      const res = await sendMessageAction({
        people: to,
        classes: classIds,
        subject,
        body,
        isTask,
        dueOn,
        mode: several ? mode : "private",
        link,
      });
      if (res.error || res.ids.length === 0) {
        setError(res.error ?? "Something went wrong. Please try again.");
        working.current = false;
        setBusy(false);
        return;
      }
      // Stays locked until the conversation opens.
      startNavigationSpinner();
      router.push(`/messages/${res.ids[0]}`);
    } catch {
      setError("Something went wrong. Please try again.");
      working.current = false;
      setBusy(false);
    }
  }

  return (
    <div className={`${CARD} space-y-4`}>
      <div>
        <span className={LABEL}>To</span>
        {(to.length > 0 || classIds.length > 0) && (
          <div className="mb-2 flex flex-wrap gap-1.5">
            {to.map((id) => (
              <button key={id} type="button" onClick={() => setTo((t) => t.filter((x) => x !== id))} className={chipClass(true)}>
                {byId.get(id)?.full_name ?? "Someone"} &times;
              </button>
            ))}
            {classIds.map((id) => (
              <button key={id} type="button" onClick={() => setClassIds((c) => c.filter((x) => x !== id))} className={chipClass(true)}>
                {classes.find((c) => c.id === id)?.name ?? "Class"}: all {L.servantsLower} &times;
              </button>
            ))}
          </div>
        )}
        <input
          type="search"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          className={INPUT}
          placeholder="Type a name…"
          aria-label="Find a person"
        />
        {matches.length > 0 && (
          <ul className="mt-1 overflow-hidden rounded-md border border-[#eee] divide-y divide-[#eee]">
            {matches.map((p) => (
              <li key={p.user_id}>
                <button
                  type="button"
                  onClick={() => addPerson(p.user_id)}
                  className="flex w-full items-center justify-between gap-2 px-3 py-2 text-left text-sm hover:bg-[#fafafa]"
                >
                  <span className="text-[#333]">{p.full_name}</span>
                  <span className="text-[11px] text-[#888]">{roleLabel(p.roles, L)}</span>
                </button>
              </li>
            ))}
          </ul>
        )}
        {q && matches.length === 0 && <p className="mt-1 text-xs text-[#888]">No one by that name.</p>}

        {classes.length > 0 && (
          <div className="mt-3">
            <span className={LABEL}>Or a whole class (all its {L.servantsLower})</span>
            <div className="flex flex-wrap gap-1.5">
              {classes.map((c) => {
                const on = classIds.includes(c.id);
                return (
                  <button
                    key={c.id}
                    type="button"
                    onClick={() => setClassIds((ids) => (on ? ids.filter((x) => x !== c.id) : [...ids, c.id]))}
                    className={chipClass(on)}
                  >
                    {c.name} ({classCount(c.id)})
                  </button>
                );
              })}
            </div>
          </div>
        )}
        <p className="mt-2 text-xs text-[#666]">
          {recipients.size === 0 ? "No one chosen yet." : `${recipients.size} ${recipients.size === 1 ? "person" : "people"}`}
        </p>
      </div>

      {several && (
        <div>
          <span className={LABEL}>Replies</span>
          <div className="space-y-1.5 text-sm text-[#333]">
            <label className="flex items-start gap-2">
              <input type="radio" name="mode" checked={mode === "private"} onChange={() => setMode("private")} className="mt-1" />
              <span>
                Each person replies privately to me
                <span className="block text-xs text-[#888]">A separate conversation with each of them.</span>
              </span>
            </label>
            <label className="flex items-start gap-2">
              <input type="radio" name="mode" checked={mode === "group"} onChange={() => setMode("group")} className="mt-1" />
              <span>
                One group conversation
                <span className="block text-xs text-[#888]">Everyone sees everyone&rsquo;s replies.</span>
              </span>
            </label>
          </div>
        </div>
      )}

      <div>
        <label className={LABEL} htmlFor="msg-subject">
          Subject
        </label>
        <input id="msg-subject" value={subject} maxLength={120} onChange={(e) => setSubject(e.target.value)} className={INPUT} />
      </div>
      <div>
        <label className={LABEL} htmlFor="msg-body">
          Message
        </label>
        <textarea id="msg-body" rows={5} value={body} maxLength={4000} onChange={(e) => setBody(e.target.value)} className={INPUT} />
      </div>
      {/* Owner-requested (10 Oct 2026, migration 0112): like announcements. */}
      <div>
        <label className={LABEL} htmlFor="msg-link">
          Link (optional)
        </label>
        <input
          id="msg-link"
          type="url"
          inputMode="url"
          placeholder="https://"
          value={link}
          maxLength={2000}
          onChange={(e) => setLink(e.target.value)}
          className={INPUT}
        />
      </div>

      <div>
        <label className="flex items-center gap-2 text-sm text-[#333]">
          <input type="checkbox" checked={isTask} onChange={(e) => setIsTask(e.target.checked)} />
          This is a task (they can mark it done, with a note)
        </label>
        {isTask && (
          <div className="mt-2">
            <label className={LABEL} htmlFor="msg-due">
              Due date (optional)
            </label>
            <input
              id="msg-due"
              type="date"
              min={today}
              value={dueOn}
              onChange={(e) => setDueOn(e.target.value)}
              className={`${INPUT} max-w-[12rem]`}
            />
            <p className="mt-1 text-xs text-[#888]">They get a reminder the day before, if it isn&rsquo;t done.</p>
          </div>
        )}
      </div>

      {error && <p className="rounded-md bg-[#f8d7da] px-3 py-2 text-sm text-[#721c24]">{error}</p>}

      <button
        type="button"
        onClick={send}
        disabled={busy || recipients.size === 0 || !subject.trim() || !body.trim()}
        className={`${PRIMARY} w-full`}
      >
        <BusyLabel busy={busy} busyText="Sending…">
          {isTask ? "Send task" : "Send"}
        </BusyLabel>
      </button>
    </div>
  );
}
