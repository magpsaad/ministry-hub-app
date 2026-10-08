"use client";

import { useRef, useState } from "react";
import { postAnnouncementAction } from "@/app/announcements/actions";
import { BusyLabel } from "@/components/PendingButton";
import { roleChips, type AnnouncementRole } from "@/lib/announcements";
import { roleLabels } from "@/lib/role-labels";

const INPUT =
  "w-full rounded-md border border-[#ddd] px-3 py-2 text-base focus:border-brand focus:outline-none focus:ring-2 focus:ring-brand/10";
const LABEL = "block text-xs font-semibold text-[#666] mb-1";

function chipClass(on: boolean) {
  return `rounded-full border px-3 py-1 text-xs font-semibold transition-colors ${
    on ? "border-brand bg-brand/10 text-brand" : "border-[#ddd] bg-white text-[#555] hover:bg-[#f5f5f5]"
  }`;
}

/** The Church Admin's announcement form (migration 0099): like a
 * ministry's, plus which ministries it goes to; classes can't be picked
 * across ministries. Role names are the standard ones here -- each
 * ministry shows its own words. */
export function ConsoleAnnouncementForm({
  ministries,
  today,
  defaultEnd,
}: {
  ministries: { id: string; name: string }[];
  today: string;
  defaultEnd: string;
}) {
  const chips = roleChips(roleLabels());
  const [picked, setPicked] = useState<string[]>(ministries.map((m) => m.id));
  const [title, setTitle] = useState("");
  const [body, setBody] = useState("");
  const [link, setLink] = useState("");
  const [roles, setRoles] = useState<AnnouncementRole[]>([]);
  const [youth, setYouth] = useState(false);
  const [importance, setImportance] = useState<"normal" | "important">("normal");
  const [startsOn, setStartsOn] = useState(today);
  const [endsOn, setEndsOn] = useState(defaultEnd);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState<string | null>(null);
  const working = useRef(false);

  async function post() {
    if (working.current) return;
    if (!picked.length) return setError("Pick at least one ministry.");
    if (!title.trim() || !body.trim()) return setError("Add a title and a message.");
    working.current = true;
    setBusy(true);
    setError(null);
    setDone(null);
    const res = await postAnnouncementAction({
      id: null,
      title,
      body,
      link: link.trim(),
      importance,
      roles,
      groups: [],
      includeYouth: youth,
      startsOn,
      endsOn,
      ministries: picked,
    });
    setBusy(false);
    working.current = false;
    if (res.error) return setError(res.error);
    const names = ministries.filter((m) => picked.includes(m.id)).map((m) => m.name);
    setDone(`Posted to ${names.join(", ")}. To edit or take it down, use that ministry's Announcements page.`);
    setTitle("");
    setBody("");
    setLink("");
  }

  return (
    <div className="max-w-2xl space-y-3 rounded-xl bg-white p-5 shadow-[0_4px_20px_rgba(0,0,0,0.06)]">
      <h2 className="text-base font-bold text-[#333]">New announcement</h2>
      <div>
        <span className={LABEL}>Post to</span>
        <div className="flex flex-wrap gap-1.5">
          {ministries.map((m) => (
            <button
              key={m.id}
              type="button"
              className={chipClass(picked.includes(m.id))}
              onClick={() => setPicked((p) => (p.includes(m.id) ? p.filter((x) => x !== m.id) : [...p, m.id]))}
            >
              {picked.includes(m.id) ? "✓ " : ""}
              {m.name}
            </button>
          ))}
        </div>
      </div>
      <div>
        <label className={LABEL} htmlFor="c-title">
          Title
        </label>
        <input id="c-title" value={title} maxLength={120} onChange={(e) => setTitle(e.target.value)} className={INPUT} />
      </div>
      <div>
        <label className={LABEL} htmlFor="c-body">
          Message
        </label>
        <textarea id="c-body" rows={4} value={body} maxLength={2000} onChange={(e) => setBody(e.target.value)} className={INPUT} />
      </div>
      <div>
        <label className={LABEL} htmlFor="c-link">
          Link (optional)
        </label>
        <input id="c-link" type="url" placeholder="https://" value={link} onChange={(e) => setLink(e.target.value)} className={INPUT} />
      </div>
      <div>
        <span className={LABEL}>Who it&rsquo;s for</span>
        <div className="flex flex-wrap gap-1.5">
          <button type="button" className={chipClass(roles.length === 0)} onClick={() => setRoles([])}>
            Everyone
          </button>
          {chips.map((c) => (
            <button
              key={c.role}
              type="button"
              className={chipClass(roles.includes(c.role))}
              onClick={() => setRoles((r) => (r.includes(c.role) ? r.filter((x) => x !== c.role) : [...r, c.role]))}
            >
              {roles.includes(c.role) ? "✓ " : ""}
              {c.label}
            </button>
          ))}
        </div>
        <label className="mt-2 flex items-center gap-2 text-sm text-[#333]">
          <input type="checkbox" checked={youth} onChange={(e) => setYouth(e.target.checked)} />
          Also show to youths on the check-in page
        </label>
      </div>
      <div>
        <span className={LABEL}>Importance</span>
        <div className="flex flex-wrap gap-1.5">
          <button type="button" className={chipClass(importance === "normal")} onClick={() => setImportance("normal")}>
            Normal: banner on the Dashboard
          </button>
          <button type="button" className={chipClass(importance === "important")} onClick={() => setImportance("important")}>
            Important: pop-up, must tap &ldquo;Got it&rdquo;
          </button>
        </div>
      </div>
      <div className="flex flex-wrap gap-4">
        <div>
          <label className={LABEL} htmlFor="c-from">
            Show from
          </label>
          <input id="c-from" type="date" value={startsOn} min={today} onChange={(e) => setStartsOn(e.target.value)} className={INPUT} />
        </div>
        <div>
          <label className={LABEL} htmlFor="c-until">
            Until
          </label>
          <input id="c-until" type="date" value={endsOn} min={startsOn || today} onChange={(e) => setEndsOn(e.target.value)} className={INPUT} />
        </div>
      </div>
      {error && <p className="rounded-md bg-[#f8d7da] px-3 py-2 text-sm text-[#721c24]">{error}</p>}
      {done && <p className="rounded-md bg-[#d4edda] px-3 py-2 text-sm text-[#155724]">{done}</p>}
      <div className="flex justify-end border-t border-[#f0f0f0] pt-3">
        <button
          type="button"
          onClick={post}
          disabled={busy}
          className="rounded-md bg-brand px-4 py-2 text-sm font-semibold text-white hover:bg-brand-dark disabled:opacity-60"
        >
          <BusyLabel busy={busy} busyText="Posting…">
            Post announcement
          </BusyLabel>
        </button>
      </div>
    </div>
  );
}
