"use client";

import { useEffect, useRef, useState } from "react";
import Link from "next/link";
import { currentAnnouncementsAction, markAnnouncementAction } from "@/app/announcements/actions";
import type { CurrentAnnouncement } from "@/lib/announcements";

/** Dashboard banners (migration 0099): Normal announcements for me that are
 * showing now and that I haven't closed. Important ones are the pop-up's
 * job (ImportantAnnouncementPopup). */
export function AnnouncementBanners() {
  const [items, setItems] = useState<CurrentAnnouncement[]>([]);
  const [closing, setClosing] = useState<string | null>(null);
  const working = useRef(false);

  useEffect(() => {
    let cancelled = false;
    currentAnnouncementsAction()
      .then((all) => {
        if (!cancelled) setItems(all.filter((a) => a.importance === "normal"));
      })
      .catch(() => {});
    return () => {
      cancelled = true;
    };
  }, []);

  async function dismiss(id: string) {
    if (working.current) return;
    working.current = true;
    setClosing(id);
    const res = await markAnnouncementAction(id, "dismiss");
    if (!res.error) setItems((list) => list.filter((a) => a.id !== id));
    setClosing(null);
    working.current = false;
  }

  if (items.length === 0) return null;
  return (
    <div className="mt-4 space-y-2">
      {items.map((a) => (
        <div key={a.id} className="rounded-lg border border-brand/30 bg-brand/5 px-4 py-3 text-sm text-[#333]">
          <div className="flex items-start justify-between gap-3">
            <p className="font-semibold text-brand">
              <span aria-hidden="true">📣 </span>
              {a.title}
            </p>
            <button
              type="button"
              onClick={() => dismiss(a.id)}
              disabled={closing !== null}
              aria-label={`Close "${a.title}"`}
              className="shrink-0 text-lg leading-none text-[#888] hover:text-[#333] disabled:opacity-50"
            >
              {closing === a.id ? "…" : "×"}
            </button>
          </div>
          <p className="mt-1 whitespace-pre-line line-clamp-3">{a.body}</p>
          <div className="mt-1.5 flex flex-wrap gap-3 text-xs font-semibold">
            <Link href="/announcements" className="text-brand hover:underline">
              Read more
            </Link>
            {a.link_url && (
              <a href={a.link_url} target="_blank" rel="noopener noreferrer" className="text-brand underline">
                Open link
              </a>
            )}
            <span className="font-normal text-[#888]">{a.author_name}</span>
          </div>
        </div>
      ))}
    </div>
  );
}
