"use client";

import { createPortal } from "react-dom";

/**
 * Owner-reported (Delete Youth, but the same root problem applies to any
 * error inside a modal whose content can scroll -- Save, photo upload, etc.
 * all had the identical bug): an inline banner near the top of a tall,
 * scrollable modal is easy to miss entirely if the user is scrolled down
 * near whatever action just failed (e.g. Delete at the very bottom) -- it
 * "looks like nothing is happening" unless they know to scroll back up.
 * A dismissible dialog is impossible to miss regardless of scroll position.
 *
 * z-[90] -- above every other modal in the app (the highest existing one,
 * PhotoCropperModal, is z-[80]), so an error surfaces on top even if it
 * happened while a nested modal (e.g. the photo cropper) was still open.
 * Its own portal keeps it from being clipped by a parent modal's own
 * overflow-y-auto scroll container.
 */
export function ErrorModal({ message, onDismiss }: { message: string; onDismiss: () => void }) {
  return createPortal(
    <div className="fixed inset-0 z-[90] flex items-center justify-center bg-black/50 p-4" onClick={onDismiss}>
      <div
        className="w-full max-w-sm rounded-xl bg-white p-5 shadow-[0_10px_40px_rgba(0,0,0,0.25)]"
        onClick={(e) => e.stopPropagation()}
      >
        <p className="text-sm text-[#333] whitespace-pre-wrap">{message}</p>
        <button
          type="button"
          onClick={onDismiss}
          className="mt-4 w-full rounded-md bg-brand px-4 py-2 text-sm font-semibold text-white hover:bg-brand-dark shadow-[0_2px_4px_rgba(0,0,0,0.15)] transition-all hover:-translate-y-0.5 hover:shadow-[0_4px_8px_rgba(0,0,0,0.2)] active:translate-y-0 active:shadow-[0_1px_2px_rgba(0,0,0,0.15)]"
        >
          OK
        </button>
      </div>
    </div>,
    document.body,
  );
}
