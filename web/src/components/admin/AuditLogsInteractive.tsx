"use client";

import { useEffect, useRef, useState, useTransition } from "react";
import type { AuditLogRow, AuditConfigRow, AuditLogUser } from "@/app/admin/audit-logs/actions";
import { getAuditLogsAction, toggleAuditConfigAction, archiveAuditLogAction } from "@/app/admin/audit-logs/actions";
import { DateFilterModal } from "@/components/outreach/DateFilterModal";
import { formatDateTimeInZone } from "@/lib/timezone";
import { useTimezone } from "@/components/TimezoneProvider";

function formatWhen(iso: string, timeZone: string): string {
  return formatDateTimeInZone(iso, timeZone, { month: "short", day: "numeric", year: "numeric", hour: "numeric", minute: "2-digit" });
}

export function AuditLogsInteractive({
  initialLogs,
  actionTypes,
  users,
  initialConfig,
}: {
  initialLogs: AuditLogRow[];
  actionTypes: string[];
  users: AuditLogUser[];
  initialConfig: AuditConfigRow[];
}) {
  const timeZone = useTimezone();
  const [logs, setLogs] = useState(initialLogs);
  const [config, setConfig] = useState(initialConfig);
  const [actionType, setActionType] = useState("");
  const [userId, setUserId] = useState("");
  const [dateFrom, setDateFrom] = useState("");
  const [dateTo, setDateTo] = useState("");
  const [showDateFilter, setShowDateFilter] = useState(false);
  const [showConfig, setShowConfig] = useState(false);
  const [archiveMsg, setArchiveMsg] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  // The page already server-rendered the unfiltered list (initialLogs), so
  // skip the effect's first run -- it used to fetch the same 300 rows again
  // straight after the page loaded. Only real filter changes re-fetch.
  const isFirstRun = useRef(true);
  useEffect(() => {
    if (isFirstRun.current) {
      isFirstRun.current = false;
      return;
    }
    startTransition(async () => {
      const rows = await getAuditLogsAction({
        actionType: actionType || undefined,
        userId: userId || undefined,
        fromDate: dateFrom || undefined,
        toDate: dateTo || undefined,
      });
      setLogs(rows);
    });
  }, [actionType, userId, dateFrom, dateTo]);

  function handleToggleConfig(type: string, enabled: boolean) {
    setConfig((prev) => prev.map((c) => (c.action_type === type ? { ...c, enabled } : c)));
    startTransition(async () => {
      await toggleAuditConfigAction(type, enabled);
    });
  }

  function handleArchive(days: number, label: string) {
    if (!confirm(`Permanently delete every log entry older than ${label}? This cannot be undone.`)) return;
    setArchiveMsg(null);
    startTransition(async () => {
      const res = await archiveAuditLogAction(days);
      if (res.error) {
        setArchiveMsg(res.error);
        return;
      }
      setArchiveMsg(`Deleted ${res.deleted} entr${res.deleted === 1 ? "y" : "ies"} older than ${label}.`);
      const rows = await getAuditLogsAction({
        actionType: actionType || undefined,
        userId: userId || undefined,
        fromDate: dateFrom || undefined,
        toDate: dateTo || undefined,
      });
      setLogs(rows);
    });
  }

  const dateFilterActive = Boolean(dateFrom || dateTo);

  return (
    <div className="space-y-4">
      <div className="rounded-xl bg-white shadow-[0_4px_20px_rgba(0,0,0,0.06)] p-5">
        <p className="text-sm font-semibold text-brand mb-3">
          {logs.length} entr{logs.length === 1 ? "y" : "ies"} shown{logs.length === 300 ? " (most recent 300 matching)" : ""}
        </p>
        <div className="flex flex-wrap items-end gap-3 mb-2">
          <label className="text-xs text-[#666]">
            Action Type
            <select
              value={actionType}
              onChange={(e) => setActionType(e.target.value)}
              className="mt-1 block rounded-md border border-[#ddd] px-2 py-1.5 text-sm focus:border-brand focus:outline-none"
            >
              <option value="">All</option>
              {actionTypes.map((t) => (
                <option key={t} value={t}>
                  {t}
                </option>
              ))}
            </select>
          </label>
          <label className="text-xs text-[#666]">
            User
            <select
              value={userId}
              onChange={(e) => setUserId(e.target.value)}
              className="mt-1 block rounded-md border border-[#ddd] px-2 py-1.5 text-sm focus:border-brand focus:outline-none"
            >
              <option value="">All users</option>
              {users.map((u) => (
                <option key={u.id} value={u.id}>
                  {u.full_name}
                </option>
              ))}
            </select>
          </label>
          <button
            type="button"
            onClick={() => setShowDateFilter(true)}
            className="flex items-center gap-1 rounded-md border border-[#ddd] px-3 py-2 text-sm text-[#333] hover:bg-[#f5f5f5] shadow-[0_2px_4px_rgba(0,0,0,0.1)] transition-all hover:-translate-y-0.5 hover:shadow-[0_4px_8px_rgba(0,0,0,0.15)] active:translate-y-0 active:shadow-[0_1px_2px_rgba(0,0,0,0.1)]"
          >
            Date Filter
            {dateFilterActive && <span className="rounded-full bg-brand text-white text-[10px] px-1.5 py-0.5">1</span>}
            <span className="text-[#999]">▾</span>
          </button>
          <button
            type="button"
            onClick={() => setShowConfig((v) => !v)}
            className="ml-auto rounded-md bg-[#f0f0f0] px-4 py-2 text-sm font-semibold text-[#333] hover:bg-[#e0e0e0] shadow-[0_2px_4px_rgba(0,0,0,0.1)] transition-all hover:-translate-y-0.5 hover:shadow-[0_4px_8px_rgba(0,0,0,0.15)] active:translate-y-0 active:shadow-[0_1px_2px_rgba(0,0,0,0.1)]"
          >
            {showConfig ? "Hide" : "Select Logged Actions"}
          </button>
        </div>

        {showConfig && (
          <div className="mt-3 border-t border-[#f0f0f0] pt-3 grid grid-cols-1 sm:grid-cols-2 gap-1 max-h-80 overflow-y-auto">
            {config.map((c) => (
              <label key={c.action_type} className="flex items-center gap-2 text-xs py-1">
                <input
                  type="checkbox"
                  checked={c.enabled}
                  onChange={(e) => handleToggleConfig(c.action_type, e.target.checked)}
                />
                <span className="font-mono text-[#666]">{c.action_type}</span>
                {c.description && <span className="text-[#999]">— {c.description}</span>}
              </label>
            ))}
          </div>
        )}
      </div>

      <div className="rounded-xl bg-white shadow-[0_4px_20px_rgba(0,0,0,0.06)] p-5">
        <h3 className="text-sm font-bold text-brand mb-2">Archive Old Entries</h3>
        <p className="text-xs text-[#666] mb-3">Permanently deletes log entries older than the selected age. Cannot be undone.</p>
        <div className="flex flex-wrap gap-2">
          <button
            type="button"
            onClick={() => handleArchive(90, "3 months")}
            disabled={pending}
            className="rounded-md bg-[#f0f0f0] px-3 py-1.5 text-xs font-semibold text-[#333] hover:bg-[#e0e0e0] disabled:opacity-60"
          >
            Older than 3 months
          </button>
          <button
            type="button"
            onClick={() => handleArchive(182, "6 months")}
            disabled={pending}
            className="rounded-md bg-[#f0f0f0] px-3 py-1.5 text-xs font-semibold text-[#333] hover:bg-[#e0e0e0] disabled:opacity-60"
          >
            Older than 6 months
          </button>
          <button
            type="button"
            onClick={() => handleArchive(365, "1 year")}
            disabled={pending}
            className="rounded-md bg-[#f0f0f0] px-3 py-1.5 text-xs font-semibold text-[#333] hover:bg-[#e0e0e0] disabled:opacity-60"
          >
            Older than 1 year
          </button>
        </div>
        {archiveMsg && <p className="mt-2 text-xs text-[#155724]">{archiveMsg}</p>}
      </div>

      <div className="rounded-xl bg-white shadow-[0_4px_20px_rgba(0,0,0,0.06)] overflow-hidden overflow-x-auto">
        <table className="w-full text-sm">
          <thead>
            <tr className="bg-[#f5f5f5] text-left text-[#666]">
              <th className="px-4 py-2 font-semibold">When</th>
              <th className="px-4 py-2 font-semibold">Action</th>
              <th className="px-4 py-2 font-semibold">User</th>
              <th className="px-4 py-2 font-semibold">Group</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-[#f0f0f0]">
            {logs.map((log) => (
              <tr key={log.id}>
                <td className="px-4 py-2 whitespace-nowrap text-[#666]">{formatWhen(log.occurred_at, timeZone)}</td>
                <td className="px-4 py-2 font-mono text-xs text-[#333]">{log.action_type}</td>
                <td className="px-4 py-2 text-[#333]">
                  {log.user_name ?? (
                    log.details?.unmatched_email ? (
                      <span className="italic text-[#856404]" title="No matching account -- this email wasn't found in the migrated servant roster">
                        {String(log.details.unmatched_email)} (unmatched)
                      </span>
                    ) : (
                      "—"
                    )
                  )}
                </td>
                <td className="px-4 py-2 text-[#666]">{log.group_name ?? "—"}</td>
              </tr>
            ))}
            {logs.length === 0 && (
              <tr>
                <td colSpan={4} className="px-4 py-6 text-center text-[#666]">
                  No log entries match.
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>

      {showDateFilter && (
        <DateFilterModal
          dateFrom={dateFrom}
          dateTo={dateTo}
          onApply={(from, to) => {
            setDateFrom(from);
            setDateTo(to);
            setShowDateFilter(false);
          }}
          onClose={() => setShowDateFilter(false)}
        />
      )}
    </div>
  );
}
