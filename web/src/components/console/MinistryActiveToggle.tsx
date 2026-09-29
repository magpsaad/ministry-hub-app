"use client";

import { useState, useTransition } from "react";
import { setMinistryActiveAction } from "@/app/console/actions";

/** MULTI_TENANT_PLAN.md §3.8 -- turning a ministry off keeps all of its
 * data; its address then shows "This ministry isn't active" and nobody but
 * the Church Admin can sign in or check in there. */
export function MinistryActiveToggle({ code, name, isActive }: { code: string; name: string; isActive: boolean }) {
  const [active, setActive] = useState(isActive);
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState<string | null>(null);

  function handleClick() {
    const next = !active;
    // The app re-checks each address at most once a minute, so the change
    // can take up to a minute to show there (QA O-2).
    const question = next
      ? `Turn ${name} (${code}) back on? Its people will be able to sign in and check in again (within about a minute).`
      : `Turn ${name} (${code}) off? Its data is kept, but nobody except you can sign in or check in there until it's turned back on. This takes effect within about a minute; you, as Church Admin, keep full access.`;
    if (!confirm(question)) return;
    setError(null);
    startTransition(async () => {
      const res = await setMinistryActiveAction(code, next);
      if (res.error) {
        setError(res.error);
        return;
      }
      setActive(next);
      setError(null);
      setDone(next ? "Turned on. Takes effect within about a minute." : "Turned off. Takes effect within about a minute.");
    });
  }

  return (
    <span className="flex flex-col items-end">
      <button
        type="button"
        onClick={handleClick}
        disabled={pending}
        className="text-xs font-semibold text-[#666] hover:text-brand hover:underline disabled:opacity-60"
      >
        {active ? "Turn off" : "Turn on"}
      </button>
      {error && <span className="text-[11px] text-[#dc3545]">{error}</span>}
      {done && !error && <span className="text-[11px] text-[#155724]">{done}</span>}
    </span>
  );
}
