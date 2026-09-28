"use client";

import { useState, useTransition } from "react";
import type { AppRelease } from "@/app/version-control/actions";
import { addReleaseAction, updateReleaseAction } from "@/app/version-control/actions";
import { todayInZone, formatDateKey } from "@/lib/timezone";
import { useTimezone } from "@/components/TimezoneProvider";

/** Owner-requested: replaces the "run SQL every time the version changes"
 * workflow -- lists every release (newest first, matching the app-wide
 * "Version X" badge, which always shows whichever release has the most
 * recent released date), lets an Admin add new ones and edit even old
 * entries. No delete -- not asked for, and a release history is meant to
 * stay a durable record.
 *
 * Owner-requested: viewable by everyone now, but `canManage` (Admin-only,
 * decided by the page) hides both the per-row Edit control and the
 * entire "Add a Release" section for anyone else -- not just disables
 * them, since the ask was specifically that non-Admins can't even see
 * those controls. Backed by app_releases' own write RLS too (is_admin()),
 * so this is a UI convenience on top of a real enforced restriction, not
 * the only thing stopping a non-Admin from writing. */
export function VersionControlInteractive({ initial, canManage }: { initial: AppRelease[]; canManage: boolean }) {
  const timeZone = useTimezone();
  const [releases, setReleases] = useState(initial);
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editVersion, setEditVersion] = useState("");
  const [editDescription, setEditDescription] = useState("");
  const [editReleasedOn, setEditReleasedOn] = useState("");

  const [newVersion, setNewVersion] = useState("");
  const [newDescription, setNewDescription] = useState("");
  const [newReleasedOn, setNewReleasedOn] = useState(() => todayInZone(timeZone));

  function handleAdd() {
    setError(null);
    if (!newVersion.trim()) {
      setError("Version number is required.");
      return;
    }
    startTransition(async () => {
      const res = await addReleaseAction(newVersion, newDescription, newReleasedOn);
      if (res.error) {
        setError(res.error);
        return;
      }
      setReleases((prev) =>
        [
          { id: res.id!, version: newVersion.trim(), description: newDescription.trim() || null, released_on: newReleasedOn },
          ...prev,
        ].sort((a, b) => (a.released_on < b.released_on ? 1 : a.released_on > b.released_on ? -1 : 0)),
      );
      setNewVersion("");
      setNewDescription("");
      setNewReleasedOn(todayInZone(timeZone));
    });
  }

  function startEdit(r: AppRelease) {
    setEditingId(r.id);
    setEditVersion(r.version);
    setEditDescription(r.description ?? "");
    setEditReleasedOn(r.released_on);
  }

  function handleSaveEdit(id: string) {
    setError(null);
    if (!editVersion.trim()) {
      setError("Version number is required.");
      return;
    }
    startTransition(async () => {
      const res = await updateReleaseAction(id, editVersion, editDescription, editReleasedOn);
      if (res.error) {
        setError(res.error);
        return;
      }
      setReleases((prev) =>
        prev
          .map((r) =>
            r.id === id
              ? { ...r, version: editVersion.trim(), description: editDescription.trim() || null, released_on: editReleasedOn }
              : r,
          )
          .sort((a, b) => (a.released_on < b.released_on ? 1 : a.released_on > b.released_on ? -1 : 0)),
      );
      setEditingId(null);
    });
  }

  return (
    <div className="rounded-xl bg-white shadow-[0_4px_20px_rgba(0,0,0,0.06)] p-5">
      <h2 className="text-lg font-bold text-brand mb-1">Release History</h2>
      <p className="text-sm text-[#666] mb-3">
        The most recent release below is what shows as the app&rsquo;s &ldquo;Version&rdquo; badge everywhere.
      </p>
      {error && <p className="mb-3 text-sm text-[#dc3545]">{error}</p>}

      <div className="divide-y divide-[#f0f0f0] mb-4">
        {releases.map((r) => (
          <div key={r.id} className="py-3 text-sm">
            {editingId === r.id ? (
              <div className="space-y-2">
                <div className="flex items-center gap-2">
                  <input
                    type="text"
                    placeholder="Version (e.g. 4.1)"
                    value={editVersion}
                    onChange={(e) => setEditVersion(e.target.value)}
                    className="w-28 rounded-md border border-[#ddd] px-2 py-1.5 text-sm focus:border-brand focus:outline-none"
                  />
                  <input
                    type="date"
                    value={editReleasedOn}
                    onChange={(e) => setEditReleasedOn(e.target.value)}
                    className="rounded-md border border-[#ddd] px-2 py-1.5 text-sm focus:border-brand focus:outline-none"
                  />
                </div>
                <textarea
                  placeholder="What's in this release?"
                  value={editDescription}
                  onChange={(e) => setEditDescription(e.target.value)}
                  rows={2}
                  className="w-full rounded-md border border-[#ddd] px-2 py-1.5 text-sm focus:border-brand focus:outline-none"
                />
                <div className="flex items-center gap-2">
                  <button
                    type="button"
                    onClick={() => handleSaveEdit(r.id)}
                    disabled={pending}
                    className="text-[#155724] text-xs font-semibold disabled:opacity-60"
                  >
                    Save
                  </button>
                  <button type="button" onClick={() => setEditingId(null)} className="text-[#666] text-xs font-semibold">
                    Cancel
                  </button>
                </div>
              </div>
            ) : (
              <div className="flex items-start gap-3">
                <div className="flex-1 min-w-0">
                  <p className="font-semibold text-[#333]">
                    Version {r.version} <span className="font-normal text-[#666]">— {formatDateKey(r.released_on, { month: "short", day: "numeric", year: "numeric" })}</span>
                  </p>
                  {r.description && <p className="text-[#666] mt-0.5">{r.description}</p>}
                </div>
                {canManage && (
                  <button type="button" onClick={() => startEdit(r)} className="text-brand text-xs font-semibold shrink-0">
                    Edit
                  </button>
                )}
              </div>
            )}
          </div>
        ))}
        {releases.length === 0 && <p className="py-2 text-sm text-[#666]">No releases logged yet.</p>}
      </div>

      {canManage && (
        <div className="border-t border-[#f0f0f0] pt-3 space-y-2">
          <h3 className="text-sm font-bold text-brand">Add a Release</h3>
          <div className="flex items-center gap-2">
            <input
              type="text"
              placeholder="Version (e.g. 4.2)"
              value={newVersion}
              onChange={(e) => setNewVersion(e.target.value)}
              className="w-28 rounded-md border border-[#ddd] px-3 py-2 text-sm focus:border-brand focus:outline-none"
            />
            <input
              type="date"
              value={newReleasedOn}
              onChange={(e) => setNewReleasedOn(e.target.value)}
              className="rounded-md border border-[#ddd] px-3 py-2 text-sm focus:border-brand focus:outline-none"
            />
          </div>
          <textarea
            placeholder="What's in this release?"
            value={newDescription}
            onChange={(e) => setNewDescription(e.target.value)}
            rows={2}
            className="w-full rounded-md border border-[#ddd] px-3 py-2 text-sm focus:border-brand focus:outline-none"
          />
          <button
            type="button"
            onClick={handleAdd}
            disabled={pending}
            className="rounded-md bg-brand px-4 py-2 text-sm font-semibold text-white hover:bg-brand-dark disabled:opacity-60 shadow-[0_2px_4px_rgba(0,0,0,0.15)] transition-all hover:-translate-y-0.5 hover:shadow-[0_4px_8px_rgba(0,0,0,0.2)] active:translate-y-0 active:shadow-[0_1px_2px_rgba(0,0,0,0.15)]"
          >
            Add
          </button>
        </div>
      )}
    </div>
  );
}
