"use client";

import { useEffect, useRef, useState } from "react";
import { usePathname } from "next/navigation";
import { currentAnnouncementsAction, markAnnouncementAction } from "@/app/announcements/actions";
import { BusyLabel } from "@/components/PendingButton";
import type { CurrentAnnouncement } from "@/lib/announcements";

/** Important announcements (migration 0099): shown once to each person,
 * the next time they open the app, until they tap "Got it" (which the
 * poster, GCs and Admins see in the read list). One at a time. Never on the
 * sign-in, check-in, onboarding or security pages, nor on the console. It
 * covers the screen, so it's shown regardless of the bottom suggestions
 * (notifications, Face ID) -- they wait underneath until "Got it".
 * Owner-reported (8 Oct 2026): a browser tab left open never looked again
 * after it first loaded, so a later Important announcement didn't appear
 * until a full refresh. It now looks again on every page change and when
 * the tab or app comes back to the front, at most once a minute. */
const RECHECK_MS = 60_000;

const EXCLUDED = ["/login", "/auth", "/checkin", "/security", "/register", "/console", "/address-not-set-up", "/ministry-inactive"];

export function ImportantAnnouncementPopup() {
  const pathname = usePathname();
  const excluded = EXCLUDED.some((p) => pathname === p || pathname.startsWith(`${p}/`));
  const [queue, setQueue] = useState<CurrentAnnouncement[]>([]);
  const [busy, setBusy] = useState(false);
  const working = useRef(false);
  const lastCheck = useRef(0);
  const showing = queue.length > 0;

  useEffect(() => {
    if (excluded || showing) return;
    let cancelled = false;
    const look = () => {
      if (document.visibilityState !== "visible" || Date.now() - lastCheck.current < RECHECK_MS) return;
      lastCheck.current = Date.now();
      currentAnnouncementsAction()
        .then((all) => {
          if (cancelled) return;
          const important = all.filter((a) => a.importance === "important");
          if (important.length > 0) setQueue(important);
        })
        .catch(() => {});
    };
    look();
    document.addEventListener("visibilitychange", look);
    window.addEventListener("focus", look);
    return () => {
      cancelled = true;
      document.removeEventListener("visibilitychange", look);
      window.removeEventListener("focus", look);
    };
  }, [excluded, showing, pathname]);

  if (excluded || queue.length === 0) return null;
  const a = queue[0];

  async function gotIt() {
    if (working.current) return;
    working.current = true;
    setBusy(true);
    const res = await markAnnouncementAction(a.id, "ack");
    setBusy(false);
    working.current = false;
    if (!res.error) setQueue((q) => q.slice(1));
  }

  return (
    <div className="fixed inset-0 z-[960] flex items-center justify-center bg-black/40 px-4" role="dialog" aria-modal="true" aria-label={a.title}>
      <div className="w-full max-w-md rounded-xl bg-white p-5 shadow-[0_8px_32px_rgba(0,0,0,0.25)]">
        <p className="text-xs font-semibold uppercase tracking-wide text-[#856404]">Important announcement</p>
        <h2 className="mt-1 text-lg font-bold text-[#333]">{a.title}</h2>
        <p className="mt-2 max-h-[50vh] overflow-y-auto whitespace-pre-line text-sm text-[#333]">{a.body}</p>
        {a.link_url && (
          <a href={a.link_url} target="_blank" rel="noopener noreferrer" className="mt-2 inline-block text-sm font-semibold text-brand underline">
            Open link
          </a>
        )}
        <p className="mt-2 text-xs text-[#888]">From {a.author_name}</p>
        <button
          type="button"
          onClick={gotIt}
          disabled={busy}
          className="mt-4 w-full rounded-md bg-brand py-2.5 text-sm font-semibold text-white hover:bg-brand-dark disabled:opacity-60"
        >
          <BusyLabel busy={busy} busyText="Saving…">
            Got it{queue.length > 1 ? ` (${queue.length - 1} more)` : ""}
          </BusyLabel>
        </button>
      </div>
    </div>
  );
}
