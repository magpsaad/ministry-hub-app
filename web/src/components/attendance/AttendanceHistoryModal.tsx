"use client";

import { createPortal } from "react-dom";

function formatDate(iso: string): string {
  const [y, m, d] = iso.split("-").map(Number);
  return new Date(y, m - 1, d).toLocaleDateString(undefined, { month: "short", day: "numeric", year: "numeric" });
}

/** Owner-requested: clicking someone's average-attendance-% opens this --
 * every service-weekday date counted in that percentage (their own
 * join_date onward, capped by the configured rolling window), each marked
 * Present/Absent, most recent first. Shared between the youth Attendance
 * tab and the Servant Attendance screen since both compute the same shape
 * of data (see lib/attendance.ts / lib/servant-attendance.ts). */
export function AttendanceHistoryModal({
  fullName,
  title,
  dates,
  onClose,
}: {
  fullName: string;
  /** Optional replacement for the plain-text name heading -- the youth
   * screens pass a link back to that youth's record (owner-requested); the
   * Servant Attendance screen leaves it out and shows the plain name. */
  title?: React.ReactNode;
  dates: { date: string; present: boolean }[];
  onClose: () => void;
}) {
  const descending = [...dates].sort((a, b) => (a.date < b.date ? 1 : -1));

  return createPortal(
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4" onClick={onClose}>
      <div
        className="w-full max-w-sm max-h-[80vh] overflow-y-auto rounded-xl bg-white p-5 shadow-[0_10px_40px_rgba(0,0,0,0.2)]"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center justify-between border-b-2 border-[#f0f0f0] pb-3 mb-3">
          <h2 className="text-lg font-bold text-brand">{title ?? fullName}</h2>
          <button onClick={onClose} className="text-[#999] hover:text-[#333] text-xl leading-none">
            ×
          </button>
        </div>
        {descending.length === 0 ? (
          <p className="text-sm text-[#666]">No tracked service dates yet.</p>
        ) : (
          <div className="divide-y divide-[#f0f0f0]">
            {descending.map((d) => (
              <div key={d.date} className="flex items-center justify-between py-2 text-sm">
                <span className="text-[#333]">{formatDate(d.date)}</span>
                <span
                  className={`rounded-full px-2.5 py-0.5 text-[11px] font-semibold ${
                    d.present ? "bg-[#d4edda] text-[#155724]" : "bg-[#f8d7da] text-[#721c24]"
                  }`}
                >
                  {d.present ? "Present" : "Absent"}
                </span>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>,
    document.body,
  );
}
