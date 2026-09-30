"use client";

import { useEffect, useState, useTransition } from "react";
import {
  getQaOnlyAccessAction,
  runRefreshAction,
  type KeepItem,
  type QaOnlyAccessRow,
  type RefreshReport,
} from "@/app/console/refresh-qa/actions";

const ROLE_LABELS: Record<string, string> = {
  admin: "System Admin",
  general_coordinator: "General Coordinator",
  sub_coordinator: "Coordinator",
  servant: "Servant",
  read_only: "Read-Only",
};

const TABLE_LABELS: Record<string, string> = {
  app_settings: "App settings",
  profiles: "Servant profiles",
  universities: "Schools",
  groups: "Groups",
  members: "Youths",
  verses: "Bible verses",
  holiday_rules: "Holiday rules",
  service_calendar_events: "Calendar events",
  pending_servants: "Pending servants",
  pending_servant_attendance: "Pending servants' attendance",
  qr_codes: "QR codes",
  user_roles: "Role grants",
  attendance_records: "Attendance",
  outreach_entries: "Outreach",
  audit_config: "Audit settings",
  actions_needed_config: "Actions Needed thresholds",
  audit_log: "Audit log",
};

const keyOf = (r: { ministry_id: string; user_id: string; role: string; group_name: string }) =>
  `${r.ministry_id}|${r.user_id}|${r.role}|${r.group_name}`;

/** Refresh QA from production: pick production ministries, choose which
 * QA-only access to keep, preview (nothing changes), then refresh. */
export function RefreshQaInteractive({ ministries }: { ministries: { id: string; name: string; in_qa: boolean }[] }) {
  const [selected, setSelected] = useState<string[]>([]);
  const [access, setAccess] = useState<QaOnlyAccessRow[]>([]);
  const [keep, setKeep] = useState<Set<string>>(new Set());
  const [loadingAccess, setLoadingAccess] = useState(false);
  const [confirming, setConfirming] = useState(false);
  const [report, setReport] = useState<RefreshReport | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  // Reload the QA-only access list whenever the chosen ministries change.
  useEffect(() => {
    let cancelled = false;
    const run = async () => {
      setLoadingAccess(true);
      const res = await getQaOnlyAccessAction(selected);
      if (cancelled) return;
      setLoadingAccess(false);
      if (res.error) {
        setError(res.error);
        return;
      }
      setAccess(res.rows);
      setKeep(new Set(res.rows.filter((r) => r.kept_before).map(keyOf)));
    };
    void run();
    return () => {
      cancelled = true;
    };
  }, [selected]);

  const allSelected = ministries.length > 0 && selected.length === ministries.length;
  const names = (ids: string[]) => ids.map((id) => ministries.find((m) => m.id === id)?.name ?? id).join(", ");

  function toggleMinistry(id: string) {
    setReport(null);
    setConfirming(false);
    setSelected((prev) => (prev.includes(id) ? prev.filter((x) => x !== id) : [...prev, id]));
  }

  function toggleKeep(k: string) {
    setKeep((prev) => {
      const next = new Set(prev);
      if (next.has(k)) next.delete(k);
      else next.add(k);
      return next;
    });
  }

  function run(dryRun: boolean) {
    setError(null);
    setReport(null);
    const items: KeepItem[] = access
      .filter((r) => keep.has(keyOf(r)))
      .map((r) => ({ ministry_id: r.ministry_id, user_id: r.user_id, role: r.role, group_name: r.group_name }));
    startTransition(async () => {
      const res = await runRefreshAction(selected, items, dryRun);
      setConfirming(false);
      if (res.error || !res.report) {
        setError(res.error ?? "The refresh didn't return a report.");
        return;
      }
      setReport(res.report);
      if (!dryRun) {
        // The QA-only list changes after a real refresh (kept grants now match).
        const again = await getQaOnlyAccessAction(selected);
        if (!again.error) {
          setAccess(again.rows);
          setKeep(new Set(again.rows.filter((r) => r.kept_before).map(keyOf)));
        }
      }
    });
  }

  const nameOf = (userId: string) => access.find((r) => r.user_id === userId)?.full_name ?? userId;

  return (
    <div className="space-y-4">
      <p className="text-sm text-[#666]">
        Replaces QA&rsquo;s copy of the ministries you choose with production&rsquo;s current data: settings, groups,
        youths, attendance, outreach, schools, verses, calendar, QR codes, servant profiles, roles, pending servants and
        the audit log. Production is only read, never changed. QA-only ministries, QA&rsquo;s web addresses, Release
        Notes and QA&rsquo;s photo files are left alone; refreshed youths and servants show initials instead of photos.
      </p>
      {error && <p className="rounded-md bg-[#f8d7da] px-3 py-2 text-sm text-[#721c24]">{error}</p>}

      <section className="rounded-xl bg-white shadow-[0_4px_20px_rgba(0,0,0,0.06)] p-5 space-y-2">
        <h2 className="text-lg font-bold text-brand">1. Which production ministries?</h2>
        <label className="flex items-center gap-2 text-sm font-semibold text-[#333]">
          <input
            type="checkbox"
            checked={allSelected}
            onChange={() => {
              setReport(null);
              setConfirming(false);
              setSelected(allSelected ? [] : ministries.map((m) => m.id));
            }}
          />
          All production ministries
        </label>
        {ministries.map((m) => (
          <label key={m.id} className="flex items-center gap-2 pl-5 text-sm text-[#333]">
            <input type="checkbox" checked={selected.includes(m.id)} onChange={() => toggleMinistry(m.id)} />
            <span className="rounded bg-[#f0f4f8] px-1.5 font-mono text-xs font-bold text-brand">{m.id}</span>
            {m.name}
            {!m.in_qa && (
              <span className="text-xs text-[#856404]">
                (not in QA yet &mdash; it will be created; add its QA address in Ministries afterwards)
              </span>
            )}
          </label>
        ))}
      </section>

      {selected.length > 0 && (
        <section className="rounded-xl bg-white shadow-[0_4px_20px_rgba(0,0,0,0.06)] p-5 space-y-3">
          <h2 className="text-lg font-bold text-brand">2. Access that exists only in QA</h2>
          <p className="text-sm text-[#666]">
            These role grants are in QA but not in production. <strong>Ticked</strong> ones are put back after the
            refresh; unticked ones disappear. Most are simply older QA roles that production has since changed, so tick
            only test accounts or access you deliberately set up for QA testing. Your ticks are remembered for next
            time.
          </p>
          {loadingAccess ? (
            <p className="text-sm text-[#999]">Loading&hellip;</p>
          ) : access.length === 0 ? (
            <p className="text-sm text-[#666]">None &mdash; QA&rsquo;s access matches production.</p>
          ) : (
            <>
              <div className="flex gap-3 text-xs">
                <button type="button" className="font-semibold text-brand hover:underline" onClick={() => setKeep(new Set(access.map(keyOf)))}>
                  Tick all
                </button>
                <button type="button" className="font-semibold text-brand hover:underline" onClick={() => setKeep(new Set())}>
                  Untick all
                </button>
                <span className="text-[#666]">
                  {keep.size} of {access.length} kept
                </span>
              </div>
              <ul className="divide-y divide-[#f0f0f0]">
                {access.map((r) => {
                  const k = keyOf(r);
                  return (
                    <li key={k}>
                      <label className="flex flex-wrap items-center gap-x-2 gap-y-0.5 py-1.5 text-sm text-[#333]">
                        <input type="checkbox" checked={keep.has(k)} onChange={() => toggleKeep(k)} />
                        <span className="font-semibold">{r.full_name}</span>
                        {r.email && <span className="text-xs text-[#999]">{r.email}</span>}
                        <span className="text-[#666]">
                          &mdash; {ROLE_LABELS[r.role] ?? r.role}
                          {r.group_name ? ` in ${r.group_name}` : " (no group)"}
                          {selected.length > 1 ? ` · ${r.ministry_id}` : ""}
                        </span>
                      </label>
                    </li>
                  );
                })}
              </ul>
            </>
          )}
        </section>
      )}

      {selected.length > 0 && (
        <section className="rounded-xl bg-white shadow-[0_4px_20px_rgba(0,0,0,0.06)] p-5 space-y-3">
          <h2 className="text-lg font-bold text-brand">3. Preview, then refresh</h2>
          <p className="text-sm text-[#666]">
            <strong>Preview</strong> runs the whole refresh and shows the counts, then undoes it &mdash; nothing changes.
            A real refresh takes a few seconds (QA pages may pause meanwhile) and keeps a backup of QA&rsquo;s current
            data first.
          </p>
          {confirming ? (
            <div className="rounded-md border border-[#dc3545] bg-[#fff5f5] p-3 space-y-2">
              <p className="text-sm text-[#721c24]">
                Replace QA&rsquo;s data for <strong>{names(selected)}</strong> with production&rsquo;s, keeping{" "}
                {keep.size} QA-only access grant{keep.size === 1 ? "" : "s"}?
              </p>
              <div className="flex gap-2">
                <button
                  type="button"
                  onClick={() => run(false)}
                  disabled={pending}
                  className="rounded-md bg-[#dc3545] px-4 py-1.5 text-sm font-semibold text-white hover:bg-[#c82333] disabled:opacity-60"
                >
                  {pending ? "Refreshing…" : "Yes, refresh QA"}
                </button>
                <button
                  type="button"
                  onClick={() => setConfirming(false)}
                  disabled={pending}
                  className="rounded-md bg-[#f0f0f0] px-4 py-1.5 text-sm font-semibold text-[#333] hover:bg-[#e0e0e0]"
                >
                  Cancel
                </button>
              </div>
            </div>
          ) : (
            <div className="flex flex-wrap gap-2">
              <button
                type="button"
                onClick={() => run(true)}
                disabled={pending || loadingAccess}
                className="rounded-md bg-[#f0f0f0] px-4 py-1.5 text-sm font-semibold text-[#333] hover:bg-[#e0e0e0] disabled:opacity-60"
              >
                {pending ? "Working…" : "Preview (no changes)"}
              </button>
              <button
                type="button"
                onClick={() => setConfirming(true)}
                disabled={pending || loadingAccess}
                className="rounded-md bg-brand px-4 py-1.5 text-sm font-semibold text-white hover:bg-brand-dark disabled:opacity-60"
              >
                Refresh QA now&hellip;
              </button>
            </div>
          )}
        </section>
      )}

      {report && (
        <section className="rounded-xl bg-white shadow-[0_4px_20px_rgba(0,0,0,0.06)] p-5 space-y-3">
          <h2 className={`text-lg font-bold ${report.dry_run ? "text-brand" : "text-[#155724]"}`}>
            {report.dry_run
              ? `Preview for ${names(report.ministries)} — nothing was changed`
              : `QA refreshed for ${names(report.ministries)}`}
          </h2>
          <p className="text-sm text-[#666]">
            Took {report.seconds} seconds.
            {!report.dry_run && " QA's previous data is kept in the backup until the next refresh."}
          </p>
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="text-left text-xs uppercase tracking-wide text-[#666]">
                  <th className="py-1 pr-3">Data</th>
                  <th className="py-1 pr-3 text-right">QA before</th>
                  <th className="py-1 pr-3 text-right">Production</th>
                  <th className="py-1 text-right">QA after</th>
                </tr>
              </thead>
              <tbody className="tabular-nums">
                {Object.entries(report.tables).map(([t, c]) => (
                  <tr key={t} className="border-t border-[#f0f0f0]">
                    <td className="py-1 pr-3">{TABLE_LABELS[t] ?? t}</td>
                    <td className="py-1 pr-3 text-right">{c.before}</td>
                    <td className="py-1 pr-3 text-right">{c.production}</td>
                    <td className={`py-1 text-right ${c.after !== c.production ? "font-semibold" : ""}`}>{c.after}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <p className="text-xs text-[#999]">
            &ldquo;QA after&rdquo; can be higher than production for servant profiles and role grants: that&rsquo;s the QA-only
            access you kept.
          </p>
          <p className="text-sm text-[#333]">
            QA-only access put back: <strong>{report.kept_applied.length}</strong>
          </p>
          {report.kept_failed.length > 0 && (
            <div className="rounded-md bg-[#fff3cd] px-3 py-2 text-sm text-[#856404]">
              <p className="font-semibold">Couldn&rsquo;t put back ({report.kept_failed.length}) &mdash; re-grant in Access Maintenance if still needed:</p>
              <ul className="list-disc pl-5">
                {report.kept_failed.map((f) => (
                  <li key={keyOf(f)}>
                    {nameOf(f.user_id)} &mdash; {ROLE_LABELS[f.role] ?? f.role}
                    {f.group_name ? ` in ${f.group_name}` : ""}: {f.reason}
                  </li>
                ))}
              </ul>
            </div>
          )}
        </section>
      )}
    </div>
  );
}
