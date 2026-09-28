"use client";

import { useEffect } from "react";

/**
 * Scoped to the group segment (sibling of layout.tsx) so an error thrown by
 * any tab's page content is caught HERE -- keeping the parent layout (nav
 * shell, tabs, header) mounted and clickable, rather than the error
 * bubbling all the way up with no boundary and wiping out the whole tree,
 * tabs included, which is what was happening before this file existed.
 */
export default function GroupSegmentError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  useEffect(() => {
    console.error(error);
  }, [error]);

  return (
    <div className="mt-4 rounded-xl bg-white shadow-[0_4px_20px_rgba(0,0,0,0.06)] p-6">
      <h2 className="text-lg font-bold text-[#dc3545]">Something went wrong loading this page</h2>
      <p className="mt-2 text-sm text-[#333] font-mono break-words">{error.message}</p>
      {error.digest && <p className="mt-1 text-xs text-[#999]">Digest: {error.digest}</p>}
      <button
        onClick={reset}
        className="mt-4 rounded-md bg-brand px-4 py-2 text-sm font-semibold text-white hover:bg-brand-dark shadow-[0_2px_4px_rgba(0,0,0,0.15)] transition-all hover:-translate-y-0.5 hover:shadow-[0_4px_8px_rgba(0,0,0,0.2)] active:translate-y-0 active:shadow-[0_1px_2px_rgba(0,0,0,0.15)]"
      >
        Try again
      </button>
    </div>
  );
}
