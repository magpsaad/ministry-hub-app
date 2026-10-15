"use client";

import { setSessionString, useSessionString } from "@/components/useSessionFlag";

/** REQUIREMENTS.md §6.3 -- collapse state persists per browser session, same
 * sessionStorage mechanism as "My Assigned List", resetting each new session.
 * Owner-requested (15 Oct 2026): each panel starts open or collapsed as the
 * person chose in My Settings -> Dashboard (`defaultOpen`); tapping anywhere
 * on the title line opens or closes it, and `summary` stays visible under
 * the title either way. */
export function CollapsibleSection({
  id,
  title,
  summary,
  defaultOpen = true,
  children,
}: {
  id: string;
  title: React.ReactNode;
  summary?: React.ReactNode;
  defaultOpen?: boolean;
  children: React.ReactNode;
}) {
  const key = `collapsed:${id}`;
  const stored = useSessionString(key);
  const hydrated = stored !== null;
  const open = stored === "true" ? false : stored === "false" ? true : defaultOpen;

  function toggle() {
    setSessionString(key, String(open));
  }

  // Before hydration the server can't know this session's choice: show the
  // starting state, so nothing jumps open and shut.
  const showBody = hydrated ? open : defaultOpen;

  return (
    <section className="bg-white rounded-xl shadow-[0_4px_20px_rgba(0,0,0,0.06)] p-5">
      <div
        role="button"
        tabIndex={0}
        aria-expanded={showBody}
        onClick={toggle}
        onKeyDown={(e) => {
          if (e.key === "Enter" || e.key === " ") {
            e.preventDefault();
            toggle();
          }
        }}
        className={`flex items-center justify-between gap-3 cursor-pointer select-none ${showBody ? "mb-3" : ""}`}
      >
        <div className="min-w-0">
          <h2 className="text-lg font-bold text-brand">{title}</h2>
          {summary && <div className="mt-0.5 text-xs text-[#666]">{summary}</div>}
        </div>
        <span
          aria-hidden
          className="h-6 w-6 shrink-0 flex items-center justify-center rounded-full bg-[#f0f0f0] text-[#333] font-bold leading-none"
        >
          {showBody ? "−" : "+"}
        </span>
      </div>
      {showBody && children}
    </section>
  );
}
