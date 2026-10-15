"use client";

import { setSessionString, useSessionString } from "@/components/useSessionFlag";

/** Owner-requested (15 Oct 2026): each panel starts open or collapsed as the
 * person chose in My Settings -> Dashboard (`defaultOpen`). Opening or
 * closing one is remembered until the end of that sign-in only: the memory
 * is kept per sign-in (`signInKey`), so signing in again -- or closing the
 * app -- starts from the My Settings choice. Tapping anywhere on the title
 * line opens or closes it; `summary` stays visible under the title either
 * way. */
export function CollapsibleSection({
  id,
  signInKey,
  title,
  summary,
  defaultOpen = true,
  children,
}: {
  id: string;
  signInKey: string;
  title: React.ReactNode;
  summary?: React.ReactNode;
  defaultOpen?: boolean;
  children: React.ReactNode;
}) {
  const key = `panel:${signInKey}:${id}`;
  // null while the page hydrates (the server can't see this), "" if not
  // tapped yet this sign-in.
  const stored = useSessionString(key);
  const showBody = stored === "open" ? true : stored === "closed" ? false : defaultOpen;

  function toggle() {
    setSessionString(key, showBody ? "closed" : "open");
  }

  return (
    <section className="bg-white rounded-xl shadow-[0_4px_20px_rgba(0,0,0,0.06)] p-5">
      <div
        id={`section-${id}`}
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
