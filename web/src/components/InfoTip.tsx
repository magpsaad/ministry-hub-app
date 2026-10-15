"use client";

import { useState } from "react";
import { createPortal } from "react-dom";
import { InfoIcon } from "@/components/icons";

/** Owner-requested (15 Oct 2026): explanations that took room on a page sit
 * behind an "i in a circle"; tapping it shows them in a small window. Taps
 * don't reach whatever the icon sits in (e.g. a panel's title line). */
export function InfoTip({ title, children, className = "" }: { title: string; children: React.ReactNode; className?: string }) {
  const [show, setShow] = useState(false);
  return (
    <>
      <button
        type="button"
        onClick={(e) => {
          e.stopPropagation();
          e.preventDefault();
          setShow(true);
        }}
        onKeyDown={(e) => e.stopPropagation()}
        aria-label={title}
        title={title}
        className={`inline-flex shrink-0 items-center justify-center align-middle text-[#888] hover:text-brand ${className}`}
      >
        <InfoIcon className="h-5 w-5" />
      </button>
      {show &&
        createPortal(
          <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4" onClick={() => setShow(false)}>
            <div
              role="dialog"
              aria-label={title}
              className="w-full max-w-md max-h-[85vh] overflow-y-auto rounded-xl bg-white p-6 shadow-[0_10px_40px_rgba(0,0,0,0.2)]"
              onClick={(e) => e.stopPropagation()}
            >
              <div className="mb-4 flex items-center justify-between border-b-2 border-[#f0f0f0] pb-3">
                <h2 className="text-lg font-bold text-brand">{title}</h2>
                <button type="button" onClick={() => setShow(false)} aria-label="Close" className="text-xl leading-none text-[#999] hover:text-[#333]">
                  ×
                </button>
              </div>
              <div className="space-y-2 text-sm text-[#333]">{children}</div>
            </div>
          </div>,
          document.body,
        )}
    </>
  );
}
