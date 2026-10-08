"use client";

import { useEffect, useState } from "react";
import { checkinAnnouncementsAction } from "@/app/checkin/actions";

/** Shown to a youth right after checking in (migration 0099): what an
 * Admin, GC or Coordinator chose to show youths of this class. */
export function CheckinAnnouncements({ token }: { token: string }) {
  const [items, setItems] = useState<{ title: string; body: string; link_url: string | null }[]>([]);

  useEffect(() => {
    let cancelled = false;
    checkinAnnouncementsAction(token)
      .then((list) => {
        if (!cancelled) setItems(list);
      })
      .catch(() => {});
    return () => {
      cancelled = true;
    };
  }, [token]);

  if (items.length === 0) return null;
  return (
    <div className="mt-4 space-y-2 text-left">
      {items.map((a, i) => (
        <div key={i} className="rounded-lg border border-[#ffe08a] bg-[#fff8e1] px-4 py-3 text-sm text-[#5c4400]">
          <p className="font-semibold">
            <span aria-hidden="true">📣 </span>
            {a.title}
          </p>
          <p className="mt-1 whitespace-pre-line">{a.body}</p>
          {a.link_url && (
            <a href={a.link_url} target="_blank" rel="noopener noreferrer" className="mt-1 inline-block font-semibold underline">
              Open link
            </a>
          )}
        </div>
      ))}
    </div>
  );
}
