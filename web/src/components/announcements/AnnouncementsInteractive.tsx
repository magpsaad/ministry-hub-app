"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { BusyLabel } from "@/components/PendingButton";
import { useRoleLabels } from "@/components/RoleLabelsProvider";
import {
  audienceCountAction,
  markAnnouncementAction,
  postAnnouncementAction,
  readListAction,
  takeDownAnnouncementAction,
} from "@/app/announcements/actions";
import { audienceSummary, roleChips, youthSummary, type AnnouncementRole, type AnnouncementRow } from "@/lib/announcements";

const CARD = "rounded-xl bg-white shadow-[0_4px_20px_rgba(0,0,0,0.06)] p-4";
const INPUT =
  "w-full rounded-md border border-[#ddd] px-3 py-2 text-base focus:border-brand focus:outline-none focus:ring-2 focus:ring-brand/10";
const LABEL = "block text-xs font-semibold text-[#666] mb-1";
const PRIMARY =
  "rounded-md bg-brand px-4 py-2 text-sm font-semibold text-white hover:bg-brand-dark disabled:opacity-60 shadow-[0_2px_4px_rgba(0,0,0,0.15)]";
const SECONDARY = "rounded-md border border-[#ddd] bg-white px-3 py-1.5 text-xs font-semibold text-[#333] hover:bg-[#f5f5f5] disabled:opacity-60";

function chipClass(on: boolean) {
  return `rounded-full border px-3 py-1 text-xs font-semibold transition-colors ${
    on ? "border-brand bg-brand/10 text-brand" : "border-[#ddd] bg-white text-[#555] hover:bg-[#f5f5f5]"
  }`;
}

/** "2026-10-08" -> "Oct 8" (dates are the ministry's calendar days). */
function shortDate(key: string): string {
  const [y, m, d] = key.slice(0, 10).split("-").map(Number);
  return new Date(Date.UTC(y, m - 1, d)).toLocaleDateString("en-US", { month: "short", day: "numeric", timeZone: "UTC" });
}

type Draft = {
  id: string | null;
  title: string;
  body: string;
  link: string;
  importance: "normal" | "important";
  roles: AnnouncementRole[];
  groups: string[];
  includeYouth: boolean;
  startsOn: string;
  endsOn: string;
};

/** Announcements page body (migration 0099): the list for everyone; the
 * New / Edit form, Take down and the "Got it" list for those who post.
 * Coordinators (`full` false) post only to the Servants and/or the youths
 * of the classes they coordinate (0100) -- no "Everyone" chip for them.
 * Servants (`servantOnly`) post only to the youths of their class (0101). */
export function AnnouncementsInteractive({
  rows,
  canPost,
  full,
  servantOnly,
  classes,
  allClasses,
  today,
  defaultEnd,
}: {
  rows: AnnouncementRow[];
  canPost: boolean;
  /** System Admins and General Coordinators (and the Church Admin). */
  full: boolean;
  /** A Servant (no Coordinator role): youths of their class only. */
  servantOnly: boolean;
  /** The classes this person can pick (a Coordinator: theirs). */
  classes: { id: string; name: string }[];
  allClasses: { id: string; name: string }[];
  today: string;
  defaultEnd: string;
}) {
  const L = useRoleLabels();
  const router = useRouter();
  const blank = (): Draft => ({
    id: null,
    title: "",
    body: "",
    link: "",
    importance: "normal",
    roles: full || servantOnly ? [] : ["servant"],
    groups: [],
    includeYouth: servantOnly,
    startsOn: today,
    endsOn: defaultEnd,
  });
  const [draft, setDraft] = useState<Draft | null>(null);
  const [count, setCount] = useState<number | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [readList, setReadList] = useState<{ id: string; rows: { full_name: string; acknowledged_at: string | null }[] } | null>(null);
  const working = useRef(false);

  const groupName = useMemo(() => {
    const byId = new Map(allClasses.map((c) => [c.id, c.name]));
    return (id: string) => byId.get(id) ?? "a class";
  }, [allClasses]);

  // Opening the page counts as reading what's showing now (clears the
  // menu's count).
  useEffect(() => {
    rows.filter((r) => r.is_current && r.for_me && !r.seen && !r.mine).forEach((r) => void markAnnouncementAction(r.id, "seen"));
  }, [rows]);

  // The form's live "reaches about N people".
  const rolesKey = draft ? draft.roles.join(",") : "";
  const groupsKey = draft ? draft.groups.join(",") : "";
  useEffect(() => {
    if (!draft) return;
    let cancelled = false;
    const t = window.setTimeout(async () => {
      const n = await audienceCountAction(draft.roles, draft.groups, draft.includeYouth);
      if (!cancelled) setCount(n);
    }, 250);
    return () => {
      cancelled = true;
      window.clearTimeout(t);
    };
    // Only who-it's-for changes the count.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [rolesKey, groupsKey, draft === null]);

  const chips = roleChips(L).filter((c) => full || c.role === "servant");
  // A Coordinator's class choice applies to their Servants and their youths.
  const showGroups =
    !!draft &&
    (servantOnly
      ? classes.length > 1
      : full
        ? draft.roles.includes("servant") || draft.roles.includes("sub_coordinator")
        : draft.roles.includes("servant") || draft.includeYouth);

  function toggleRole(role: AnnouncementRole | "everyone") {
    setDraft((d) => {
      if (!d) return d;
      if (role === "everyone") return { ...d, roles: [], groups: [] };
      const roles = d.roles.includes(role) ? d.roles.filter((r) => r !== role) : [...d.roles, role];
      const keepGroups = full ? roles.includes("servant") || roles.includes("sub_coordinator") : roles.includes("servant") || d.includeYouth;
      return { ...d, roles, groups: keepGroups ? d.groups : [] };
    });
  }

  function toggleGroup(id: string) {
    setDraft((d) => (d ? { ...d, groups: d.groups.includes(id) ? d.groups.filter((g) => g !== id) : [...d.groups, id] } : d));
  }

  function edit(r: AnnouncementRow) {
    setError(null);
    setDraft({
      id: r.id,
      title: r.title,
      body: r.body,
      link: r.link_url ?? "",
      importance: r.importance,
      roles: r.roles ?? [],
      groups: (full ? r.servant_group_ids ?? r.coordinator_group_ids : r.servant_group_ids) ?? [],
      includeYouth: r.include_youth,
      startsOn: r.starts_on,
      endsOn: r.ends_on,
    });
    window.scrollTo({ top: 0, behavior: "smooth" });
  }

  async function run(key: string, task: () => Promise<{ error: string | null }>, after?: () => void) {
    if (working.current) return;
    working.current = true;
    setBusy(key);
    setError(null);
    try {
      const res = await task();
      if (res.error) setError(res.error);
      else {
        after?.();
        router.refresh();
      }
    } finally {
      working.current = false;
      setBusy(null);
    }
  }

  function post() {
    if (!draft) return;
    if (!draft.title.trim() || !draft.body.trim()) {
      setError("Add a title and a message.");
      return;
    }
    if (!full && draft.roles.length === 0 && !draft.includeYouth) {
      setError(`Choose the ${L.servantsLower} of your classes, the youths, or both.`);
      return;
    }
    // A Coordinator's "all my classes" is sent as their classes explicitly
    // only when they picked some; none picked = all of theirs.
    void run("post", () => postAnnouncementAction({ ...draft, link: draft.link.trim() }), () => setDraft(null));
  }

  async function openReadList(id: string) {
    if (working.current) return;
    working.current = true;
    setBusy(`read:${id}`);
    const res = await readListAction(id);
    working.current = false;
    setBusy(null);
    if (res.error) setError(res.error);
    else setReadList({ id, rows: res.rows });
  }

  const current = rows.filter((r) => r.is_current);
  const other = rows.filter((r) => !r.is_current);

  function status(r: AnnouncementRow): string {
    if (r.taken_down) return "Taken down";
    if (r.starts_on > today) return `Starts ${shortDate(r.starts_on)}, until ${shortDate(r.ends_on)}`;
    if (r.ends_on < today) return `Ended ${shortDate(r.ends_on)}`;
    return `Showing until ${shortDate(r.ends_on)}`;
  }

  function renderRow(r: AnnouncementRow) {
    return (
      <li key={r.id} className={`${CARD} ${r.taken_down || r.ends_on < today ? "opacity-70" : ""}`}>
        <div className="flex items-start justify-between gap-3">
          <div className="min-w-0">
            <p className="font-semibold text-[#333]">
              {r.importance === "important" && (
                <span className="mr-2 rounded bg-[#fff3cd] px-1.5 py-0.5 text-[11px] font-semibold uppercase text-[#856404]">Important</span>
              )}
              {r.title}
              {r.is_current && r.for_me && !r.seen && !r.mine && (
                <span className="ml-2 rounded-full bg-[#dc3545] px-2 py-0.5 text-[10px] font-semibold text-white">New</span>
              )}
            </p>
            <p className="mt-0.5 text-xs text-[#888]">
              {r.mine ? "You" : r.author_name} · {shortDate(r.created_at.slice(0, 10))} · {status(r)}
            </p>
          </div>
        </div>
        <p className="mt-2 whitespace-pre-line text-sm text-[#333]">{r.body}</p>
        {r.link_url && (
          <a href={r.link_url} target="_blank" rel="noopener noreferrer" className="mt-1 inline-block text-sm font-semibold text-brand underline">
            Open link
          </a>
        )}
        {(r.mine || full) && (
          <p className="mt-2 text-xs text-[#777]">
            For: {audienceSummary(r, groupName, L)}
            {r.audience_count !== null && (r.roles === null || r.roles.length > 0)
              ? ` · ${r.audience_count} ${r.audience_count === 1 ? "person" : "people"}`
              : ""}
            {youthSummary(r, groupName)
              ? r.roles !== null && r.roles.length === 0
                ? ` (${youthSummary(r, groupName)})`
                : `, plus ${youthSummary(r, groupName)}`
              : ""}
          </p>
        )}
        <div className="mt-2 flex flex-wrap gap-2">
          {r.importance === "important" && r.ack_count !== null && (
            <button type="button" onClick={() => openReadList(r.id)} disabled={busy !== null} className={SECONDARY}>
              <BusyLabel busy={busy === `read:${r.id}`} busyText="Loading…">
                Got it: {r.ack_count} of {r.audience_count ?? "?"}
              </BusyLabel>
            </button>
          )}
          {r.can_edit && (
            <>
              <button type="button" onClick={() => edit(r)} disabled={busy !== null} className={SECONDARY}>
                Edit
              </button>
              <button
                type="button"
                onClick={() => {
                  if (confirm(`Take down "${r.title}"? It stops showing to everyone.`)) {
                    void run(`down:${r.id}`, () => takeDownAnnouncementAction(r.id));
                  }
                }}
                disabled={busy !== null}
                className={`${SECONDARY} text-[#dc3545]`}
              >
                <BusyLabel busy={busy === `down:${r.id}`} busyText="Taking down…">
                  Take down
                </BusyLabel>
              </button>
            </>
          )}
        </div>
        {readList?.id === r.id && (
          <div className="mt-3 rounded-md border border-[#eee] p-3">
            <div className="mb-1 flex items-center justify-between">
              <span className="text-xs font-semibold text-[#666]">Who has tapped &ldquo;Got it&rdquo;</span>
              <button type="button" onClick={() => setReadList(null)} className="text-xs text-[#888] hover:underline">
                Close
              </button>
            </div>
            <ul className="divide-y divide-[#f0f0f0] text-sm">
              {readList.rows.map((p, i) => (
                <li key={i} className="flex justify-between py-1">
                  <span className="text-[#333]">{p.full_name}</span>
                  <span className={p.acknowledged_at ? "text-[#155724]" : "text-[#999]"}>
                    {p.acknowledged_at ? `Got it, ${shortDate(p.acknowledged_at.slice(0, 10))}` : "Not yet"}
                  </span>
                </li>
              ))}
            </ul>
          </div>
        )}
      </li>
    );
  }

  return (
    <div className="space-y-4">
      {canPost && !draft && (
        <button
          type="button"
          onClick={() => {
            setError(null);
            setCount(null);
            setDraft(blank());
          }}
          className={`${PRIMARY} w-full`}
        >
          + New announcement
        </button>
      )}

      {error && <p className="rounded-md bg-[#f8d7da] px-3 py-2 text-sm text-[#721c24]">{error}</p>}

      {draft && (
        <div className={`${CARD} space-y-3`}>
          <h2 className="text-base font-bold text-[#333]">{draft.id ? "Edit announcement" : "New announcement"}</h2>
          <div>
            <label className={LABEL} htmlFor="ann-title">Title</label>
            <input id="ann-title" value={draft.title} maxLength={120} onChange={(e) => setDraft({ ...draft, title: e.target.value })} className={INPUT} />
          </div>
          <div>
            <label className={LABEL} htmlFor="ann-body">Message</label>
            <textarea id="ann-body" rows={4} value={draft.body} maxLength={2000} onChange={(e) => setDraft({ ...draft, body: e.target.value })} className={INPUT} />
          </div>
          <div>
            <label className={LABEL} htmlFor="ann-link">Link (optional)</label>
            <input id="ann-link" type="url" placeholder="https://" value={draft.link} onChange={(e) => setDraft({ ...draft, link: e.target.value })} className={INPUT} />
          </div>

          {servantOnly ? (
            <div>
              <span className={LABEL}>Who it&rsquo;s for</span>
              <p className="text-sm text-[#333]">
                The youths of your {classes.length === 1 ? `class (${classes[0]?.name ?? ""})` : "classes"}. They see it on the check-in page
                after they check in.
              </p>
            </div>
          ) : (
          <div>
            <span className={LABEL}>Who it&rsquo;s for</span>
            {!full && (
              <p className="mb-1.5 text-xs text-[#777]">
                As a {L.coordinatorLower}, you can post to the {L.servantsLower} and the youths of the classes you coordinate.
              </p>
            )}
            <div className="flex flex-wrap gap-1.5">
              {full && (
                <button type="button" onClick={() => toggleRole("everyone")} className={chipClass(draft.roles.length === 0)}>
                  Everyone
                </button>
              )}
              {chips.map((c) => (
                <button key={c.role} type="button" onClick={() => toggleRole(c.role)} className={chipClass(draft.roles.includes(c.role))}>
                  {draft.roles.includes(c.role) ? "✓ " : ""}
                  {!full && c.role === "servant" ? `${L.servants} of my classes` : c.label}
                </button>
              ))}
            </div>
            <label className="mt-2 flex items-center gap-2 text-sm text-[#333]">
              <input
                type="checkbox"
                checked={draft.includeYouth}
                onChange={(e) =>
                  setDraft({
                    ...draft,
                    includeYouth: e.target.checked,
                    groups: full || e.target.checked || draft.roles.includes("servant") ? draft.groups : [],
                  })
                }
              />
              {full ? "Also show to youths on the check-in page" : "The youths of my classes (on the check-in page)"}
            </label>
          </div>
          )}

          {showGroups && (
            <div className="rounded-md border border-[#eee] p-3">
              <span className={LABEL}>
                {full ? `Group ${L.servants} & ${L.coordinators}` : "Which classes"}{" "}
                <span className="font-normal text-[#999]">(none picked = {full ? "every class" : "all your classes"})</span>
              </span>
              <div className="flex flex-wrap gap-1.5">
                {classes.map((c) => (
                  <button key={c.id} type="button" onClick={() => toggleGroup(c.id)} className={chipClass(draft.groups.includes(c.id))}>
                    {draft.groups.includes(c.id) ? "✓ " : ""}
                    {c.name}
                  </button>
                ))}
              </div>
            </div>
          )}
          <p className="text-xs text-[#777]">
            {servantOnly || (!full && draft.roles.length === 0)
              ? draft.includeYouth
                ? "No one in the app: only the youths of these classes, after they check in."
                : ""
              : `${count === null ? "Counting…" : `Reaches ${count} ${count === 1 ? "person" : "people"} in the app`}${
                  draft.includeYouth ? ", plus youths after they check in (not counted)." : "."
                }`}
          </p>

          {!servantOnly && (
          <div>
            <span className={LABEL}>Importance</span>
            <div className="flex flex-wrap gap-1.5">
              <button type="button" onClick={() => setDraft({ ...draft, importance: "normal" })} className={chipClass(draft.importance === "normal")}>
                Normal: banner on the Dashboard
              </button>
              <button type="button" onClick={() => setDraft({ ...draft, importance: "important" })} className={chipClass(draft.importance === "important")}>
                Important: pop-up, must tap &ldquo;Got it&rdquo;
              </button>
            </div>
          </div>
          )}

          <div className="flex flex-wrap gap-4">
            <div>
              <label className={LABEL} htmlFor="ann-from">Show from</label>
              <input id="ann-from" type="date" value={draft.startsOn} min={draft.id ? undefined : today} onChange={(e) => setDraft({ ...draft, startsOn: e.target.value })} className={INPUT} />
            </div>
            <div>
              <label className={LABEL} htmlFor="ann-until">Until</label>
              <input id="ann-until" type="date" value={draft.endsOn} min={draft.startsOn || today} onChange={(e) => setDraft({ ...draft, endsOn: e.target.value })} className={INPUT} />
            </div>
          </div>

          <div className="flex justify-end gap-2 border-t border-[#f0f0f0] pt-3">
            <button type="button" onClick={() => setDraft(null)} disabled={busy !== null} className={SECONDARY}>
              Cancel
            </button>
            <button type="button" onClick={post} disabled={busy !== null} className={PRIMARY}>
              <BusyLabel busy={busy === "post"} busyText={draft.id ? "Saving…" : "Posting…"}>
                {draft.id ? "Save changes" : "Post announcement"}
              </BusyLabel>
            </button>
          </div>
        </div>
      )}

      {rows.length === 0 ? (
        <p className={`${CARD} text-sm text-[#666]`}>No announcements yet.</p>
      ) : (
        <>
          {current.length > 0 && <ul className="space-y-3">{current.map(renderRow)}</ul>}
          {other.length > 0 && (
            <>
              <h2 className="pt-2 text-xs font-bold uppercase tracking-wide text-[#888]">Earlier and upcoming</h2>
              <ul className="space-y-3">{other.map(renderRow)}</ul>
            </>
          )}
        </>
      )}
    </div>
  );
}
