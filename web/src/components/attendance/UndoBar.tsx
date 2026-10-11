"use client";

import { useEffect, useRef, useState } from "react";
import { BusyLabel } from "@/components/PendingButton";

export type UndoInfo = {
  /** New for each change, so the 4 seconds start again. */
  id: number;
  message: string;
  /** Puts it back; true when that worked. */
  undo: () => Promise<boolean>;
};

const SHOW_MS = 4000;

/** Owner-approved (11 Oct 2026): after marking someone on an attendance
 * sheet, a bar at the bottom says what changed, with Undo, for 4 seconds.
 * Marking Present no longer asks first; marking Absent still does. */
export function UndoBar({ info, onClose }: { info: UndoInfo | null; onClose: () => void }) {
  const [busy, setBusy] = useState(false);
  const working = useRef(false);

  useEffect(() => {
    if (!info) return;
    const t = window.setTimeout(() => {
      if (!working.current) onClose();
    }, SHOW_MS);
    return () => window.clearTimeout(t);
  }, [info, onClose]);

  if (!info) return null;

  async function handleUndo() {
    if (!info || working.current) return;
    working.current = true;
    setBusy(true);
    await info.undo();
    working.current = false;
    setBusy(false);
    onClose();
  }

  return (
    <div
      role="status"
      className="fixed inset-x-0 bottom-[calc(1rem+env(safe-area-inset-bottom))] z-[90] flex justify-center px-4 pointer-events-none"
    >
      <div className="pointer-events-auto flex max-w-md min-w-0 items-center gap-3 rounded-lg bg-[#333] px-4 py-2.5 text-sm text-white shadow-[0_4px_20px_rgba(0,0,0,0.25)]">
        <span className="min-w-0 overflow-hidden whitespace-nowrap">{info.message}</span>
        <button
          type="button"
          onClick={handleUndo}
          disabled={busy}
          className="shrink-0 font-semibold uppercase tracking-wide text-[#ffd479] disabled:opacity-60"
        >
          <BusyLabel busy={busy}>Undo</BusyLabel>
        </button>
      </div>
    </div>
  );
}
