"use client";

import { useEffect, useState } from "react";

/** REQUIREMENTS.md §6.3 -- collapse state persists per browser session, same
 * sessionStorage mechanism as "My Assigned List", resetting each new session. */
export function CollapsibleSection({
  id,
  title,
  children,
}: {
  id: string;
  title: React.ReactNode;
  children: React.ReactNode;
}) {
  const key = `collapsed:${id}`;
  const [open, setOpen] = useState(true);
  const [hydrated, setHydrated] = useState(false);

  useEffect(() => {
    setOpen(sessionStorage.getItem(key) !== "true");
    setHydrated(true);
  }, [key]);

  function toggle() {
    const next = !open;
    setOpen(next);
    sessionStorage.setItem(key, String(!next));
  }

  const showBody = !hydrated || open;

  return (
    <section className="bg-white rounded-xl shadow-[0_4px_20px_rgba(0,0,0,0.06)] p-5">
      <div className="flex items-center justify-between mb-3">
        <h2 className="text-lg font-bold text-brand">{title}</h2>
        <button
          onClick={toggle}
          aria-label={open ? "Collapse section" : "Expand section"}
          className="h-6 w-6 flex items-center justify-center rounded-full bg-[#f0f0f0] text-[#333] hover:bg-[#e0e0e0] font-bold leading-none"
        >
          {hydrated && !open ? "+" : "−"}
        </button>
      </div>
      {showBody && children}
    </section>
  );
}
