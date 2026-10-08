"use client";

import { useEffect, useMemo, useState, useTransition } from "react";
import type { GroupSummary } from "@/lib/groups";
import { getGroupMemberNamesAction, getServantNamesAction } from "@/app/export-lists/actions";
import { csvCell } from "@/lib/csv";
import { useRoleLabels } from "@/components/RoleLabelsProvider";

const SERVANTS_KEY = "servants";

/** Owner-requested: export or print a names-only list -- either one
 * cohort's roster (never Yr0, already excluded from `groups`) or the
 * overall Servants list. Every source action selects only `full_name`, so
 * there's no other profile/member field for this screen to ever display,
 * export, or print, by construction. */
export function ExportListsInteractive({
  groups,
  memberLabel,
  appTitle,
}: {
  groups: GroupSummary[];
  memberLabel: string;
  appTitle: string;
}) {
  const L = useRoleLabels();
  const [selectedKey, setSelectedKey] = useState<string>(groups[0]?.id ?? SERVANTS_KEY);
  const [names, setNames] = useState<string[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [loading, startTransition] = useTransition();

  const listTitle = useMemo(() => {
    if (selectedKey === SERVANTS_KEY) return L.servants;
    return groups.find((g) => g.id === selectedKey)?.name ?? "";
  }, [selectedKey, groups, L.servants]);

  useEffect(() => {
    startTransition(async () => {
      try {
        const result = selectedKey === SERVANTS_KEY ? await getServantNamesAction() : await getGroupMemberNamesAction(selectedKey);
        setNames(result);
        setError(null);
      } catch {
        setError("Couldn't load that list. Please try again.");
      }
    });
  }, [selectedKey]);

  function downloadBlob(blob: Blob, filename: string) {
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    a.remove();
    URL.revokeObjectURL(url);
  }

  function handleDownloadCsv() {
    const csv = [csvCell(listTitle), ...names.map((n) => csvCell(n))].join("\r\n");
    downloadBlob(new Blob([csv], { type: "text/csv;charset=utf-8;" }), `${listTitle}.csv`);
  }

  async function handleDownloadPdf() {
    const { jsPDF } = await import("jspdf");
    const doc = new jsPDF({ unit: "pt", format: "letter" });
    const pageWidth = doc.internal.pageSize.getWidth();
    const pageHeight = doc.internal.pageSize.getHeight();
    const marginX = 48;
    const marginTop = 56;
    const marginBottom = 48;
    const lineHeight = 16;

    // Owner-requested: three columns per page so a long list fits on fewer
    // sheets. Names run down each column in order (the same way the on-screen
    // list and Print flow), then continue in the next column and page.
    const columnCount = 3;
    const columnGap = 18;
    const columnWidth = (pageWidth - marginX * 2 - columnGap * (columnCount - 1)) / columnCount;

    doc.setFont("helvetica", "bold");
    doc.setFontSize(16);
    doc.text(listTitle, marginX, marginTop);
    doc.setFont("helvetica", "normal");
    doc.setFontSize(11);

    const limitY = pageHeight - marginBottom;
    let columnTop = marginTop + 28; // first page leaves room for the title
    let column = 0;
    let y = columnTop;
    for (const name of names) {
      // A name too long for one column wraps onto extra lines instead of
      // running into the next column.
      const lines: string[] = doc.splitTextToSize(name, columnWidth);
      const height = lines.length * lineHeight;
      if (y + height > limitY) {
        column += 1;
        if (column === columnCount) {
          doc.addPage();
          column = 0;
          columnTop = marginTop;
        }
        y = columnTop;
      }
      const x = marginX + column * (columnWidth + columnGap);
      for (const line of lines) {
        doc.text(line, x, y);
        y += lineHeight;
      }
    }
    doc.save(`${listTitle}.pdf`);
  }

  function handlePrint() {
    window.print();
  }

  return (
    <div className="space-y-4">
      <div className="rounded-xl bg-white shadow-[0_4px_20px_rgba(0,0,0,0.06)] p-5 print:hidden">
        <h2 className="text-lg font-bold text-brand mb-1">Export or Print a List</h2>
        <p className="text-xs text-[#666] mb-4">
          Names only -- no phone, email, attendance, or other {memberLabel.toLowerCase()}/{L.servantLower} details are ever included.
        </p>

        <label className="block text-sm font-semibold text-[#333] mb-1">Which list?</label>
        <select
          value={selectedKey}
          onChange={(e) => setSelectedKey(e.target.value)}
          className="w-full rounded-md border border-[#ddd] px-3 py-2 text-sm focus:border-brand focus:outline-none"
        >
          {groups.map((g) => (
            <option key={g.id} value={g.id}>
              {g.name}
            </option>
          ))}
          <option value={SERVANTS_KEY}>{L.servants}</option>
        </select>

        <div className="mt-4 flex flex-wrap gap-2">
          <button
            type="button"
            onClick={handleDownloadCsv}
            disabled={loading || names.length === 0}
            className="rounded-md bg-brand px-4 py-2 text-sm font-semibold text-white hover:bg-brand-dark disabled:opacity-50 shadow-[0_2px_4px_rgba(0,0,0,0.15)] transition-all hover:-translate-y-0.5 hover:shadow-[0_4px_8px_rgba(0,0,0,0.2)] active:translate-y-0 active:shadow-[0_1px_2px_rgba(0,0,0,0.15)]"
          >
            Download CSV
          </button>
          <button
            type="button"
            onClick={handleDownloadPdf}
            disabled={loading || names.length === 0}
            className="rounded-md bg-brand px-4 py-2 text-sm font-semibold text-white hover:bg-brand-dark disabled:opacity-50 shadow-[0_2px_4px_rgba(0,0,0,0.15)] transition-all hover:-translate-y-0.5 hover:shadow-[0_4px_8px_rgba(0,0,0,0.2)] active:translate-y-0 active:shadow-[0_1px_2px_rgba(0,0,0,0.15)]"
          >
            Download PDF
          </button>
          <button
            type="button"
            onClick={handlePrint}
            disabled={loading || names.length === 0}
            className="rounded-md bg-[#f0f0f0] px-4 py-2 text-sm font-semibold text-[#333] hover:bg-[#e0e0e0] disabled:opacity-50 shadow-[0_2px_4px_rgba(0,0,0,0.1)] transition-all hover:-translate-y-0.5 hover:shadow-[0_4px_8px_rgba(0,0,0,0.15)] active:translate-y-0 active:shadow-[0_1px_2px_rgba(0,0,0,0.1)]"
          >
            Print
          </button>
        </div>
        {error && <p className="mt-3 text-sm text-[#dc3545]">{error}</p>}
      </div>

      <div className="rounded-xl bg-white shadow-[0_4px_20px_rgba(0,0,0,0.06)] p-5 print:shadow-none print:rounded-none print:p-0">
        {/* Owner-requested: the group picker itself already excludes Yr0
            (never present in `groups`); "Servants" is a separate, fixed
            entry alongside it, not another cohort. */}
        <h3 className="text-base font-bold text-brand print:text-xl">{listTitle}</h3>
        <p className="hidden print:block text-xs text-[#666] mb-3">{appTitle}</p>
        {loading ? (
          <p className="mt-2 text-sm text-[#666] print:hidden">Loading…</p>
        ) : names.length === 0 ? (
          <p className="mt-2 text-sm text-[#666]">
            No {selectedKey === SERVANTS_KEY ? L.servantsLower : memberLabel.toLowerCase() + "s"} found.
          </p>
        ) : (
          <ol className="mt-2 columns-1 sm:columns-2 print:columns-2 gap-x-6 text-sm text-[#333] list-decimal list-inside">
            {names.map((name) => (
              <li key={name} className="py-0.5 break-inside-avoid">
                {name}
              </li>
            ))}
          </ol>
        )}
      </div>
    </div>
  );
}
