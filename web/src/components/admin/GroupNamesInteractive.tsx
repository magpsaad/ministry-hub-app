"use client";

import { useRef, useState, useTransition } from "react";
import type { AdminGroupRow, AddGroupTierInput } from "@/app/admin/actions-needed-config/actions";
import {
  renameGroupAction,
  addGroupTierAction,
  deleteGroupTierAction,
  updateGroupQrColorAction,
  updateServantsQrColorAction,
} from "@/app/admin/actions-needed-config/actions";

const SERVANTS = "servants";

/** REQUIREMENTS.md §6.9/§6.14 -- rename any active group's display name,
 * and extend/shrink the active ladder by a tier. Add/Delete go through
 * add_group_tier()/delete_group_tier() (migration 0030), which keep
 * ladder_position contiguous -- required for run_group_transition() (also
 * generalized in 0030) to keep working for any ladder length. Name is
 * always required when adding a group (migration 0033) -- no auto-naming
 * from group_name_template, since a cohort's naming convention might look
 * completely different in future years than whatever the template says
 * today (owner's call). */
export function GroupNamesInteractive({
  initial,
  positionLabel,
  groupLabel,
  initialServantsQrColor,
}: {
  initial: AdminGroupRow[];
  positionLabel: string;
  groupLabel: string;
  /** The Servants QR colour -- also what a group with no colour of its own
   * prints in (lib/qrcodes.ts). */
  initialServantsQrColor: string;
}) {
  const [groups, setGroups] = useState(initial);
  const [servantsQrColor, setServantsQrColor] = useState(initialServantsQrColor);
  const [colorStatus, setColorStatus] = useState<Record<string, "saving" | "saved">>({});
  const colorTimers = useRef<Record<string, ReturnType<typeof setTimeout>>>({});

  // The colour picker reports every step while dragging, so save once the
  // colour has stopped changing for a moment. `key` is a group id, or
  // SERVANTS for the Servants QR.
  function handleQrColor(key: string, color: string) {
    setError(null);
    if (key === SERVANTS) setServantsQrColor(color);
    else setGroups((prev) => prev.map((g) => (g.id === key ? { ...g, qr_color: color } : g)));
    setColorStatus((prev) => ({ ...prev, [key]: "saving" }));
    clearTimeout(colorTimers.current[key]);
    colorTimers.current[key] = setTimeout(async () => {
      const res = key === SERVANTS ? await updateServantsQrColorAction(color) : await updateGroupQrColorAction(key, color);
      if (res.error) {
        setError(res.error);
        setColorStatus((prev) => {
          const next = { ...prev };
          delete next[key];
          return next;
        });
        return;
      }
      setColorStatus((prev) => ({ ...prev, [key]: "saved" }));
    }, 600);
  }

  // One row's colour dot (and its "Saving…"/"Saved" note). Group rows and
  // the Servants row use the same markup so every dot lines up.
  function colorDot(key: string, color: string, label: string) {
    return (
      <>
        {colorStatus[key] && (
          <span className="text-[11px] text-[#999]">{colorStatus[key] === "saving" ? "Saving…" : "Saved"}</span>
        )}
        <input
          type="color"
          value={color}
          onChange={(e) => handleQrColor(key, e.target.value)}
          title={`QR code colour for ${label}`}
          aria-label={`QR code colour for ${label}`}
          className="h-7 w-7 shrink-0 cursor-pointer appearance-none rounded-full border border-[#ddd] bg-transparent p-0 [&::-moz-color-swatch]:rounded-full [&::-moz-color-swatch]:border-none [&::-webkit-color-swatch]:rounded-full [&::-webkit-color-swatch]:border-none [&::-webkit-color-swatch-wrapper]:p-0"
        />
      </>
    );
  }

  // Invisible stand-ins, same size as the Rename/Delete buttons.
  const renamePlaceholder = (
    <span aria-hidden="true" className="invisible rounded-md px-3 py-1.5 text-xs font-semibold">
      Rename
    </span>
  );
  const deletePlaceholder = (
    <span aria-hidden="true" className="invisible rounded-md border px-3 py-1.5 text-xs font-semibold">
      Delete
    </span>
  );
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editingName, setEditingName] = useState("");
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);

  const [showAddForm, setShowAddForm] = useState(false);
  const [addForm, setAddForm] = useState<AddGroupTierInput>({ cohortYear: null, name: "", qrColor: "#999999" });

  const terminalPosition = groups.length > 0 ? Math.max(...groups.map((g) => g.ladder_position)) : null;

  function startEdit(g: AdminGroupRow) {
    setError(null);
    setEditingId(g.id);
    setEditingName(g.name);
  }

  function handleSaveRename(groupId: string) {
    setError(null);
    startTransition(async () => {
      const res = await renameGroupAction(groupId, editingName);
      if (res.error) {
        setError(res.error);
        return;
      }
      setGroups((prev) => prev.map((g) => (g.id === groupId ? { ...g, name: editingName } : g)));
      setEditingId(null);
    });
  }

  function handleAdd() {
    if (!addForm.name.trim()) {
      setError("Name is required.");
      return;
    }
    setError(null);
    startTransition(async () => {
      const res = await addGroupTierAction(addForm);
      if (res.error) {
        setError(res.error);
        return;
      }
      setShowAddForm(false);
      setAddForm({ cohortYear: null, name: "", qrColor: "#999999" });
      // The shift/insert changes multiple rows at once (terminal renumbers,
      // possibly renames) -- simplest to just re-fetch rather than
      // hand-patch local state for every affected row.
      window.location.reload();
    });
  }

  function handleDelete(g: AdminGroupRow) {
    if (!confirm(`Remove "${g.name}"? This only works if it has no active members or role grants left.`)) return;
    setError(null);
    startTransition(async () => {
      const res = await deleteGroupTierAction(g.id);
      if (res.error) {
        setError(res.error);
        return;
      }
      window.location.reload();
    });
  }

  return (
    <div className="rounded-xl bg-white shadow-[0_4px_20px_rgba(0,0,0,0.06)] p-5">
      <h2 className="text-lg font-bold text-brand mb-1">Group Names &amp; QR Code Colors</h2>
      <p className="text-sm text-[#666] mb-4">
        Every active group in the cohort ladder, position 0 (pre-entry) through the terminal group. Rename any of
        them directly, or add/remove a tier if this deployment needs more or fewer active years than the default.
        Click a colour dot to change that QR code&rsquo;s colour (the Servants QR is at the bottom); it saves
        straight away.
      </p>
      {error && <p className="mb-3 text-sm text-[#dc3545]">{error}</p>}

      <div className="divide-y divide-[#f0f0f0] mb-4">
        {groups.map((g) => {
          const isPreEntry = g.ladder_position === 0;
          const isTerminal = g.ladder_position === terminalPosition;
          return (
            <div key={g.id} className="py-2 flex items-center gap-3">
              <span className="w-14 shrink-0 text-xs font-semibold text-[#666]">
                {isPreEntry
                  ? `${positionLabel} 0`
                  : isTerminal
                    ? `${positionLabel} ${g.ladder_position}+`
                    : `${positionLabel} ${g.ladder_position}`}
              </span>
              {editingId === g.id ? (
                <>
                  <input
                    value={editingName}
                    onChange={(e) => setEditingName(e.target.value)}
                    className="flex-1 min-w-0 rounded-md border border-[#ddd] px-2 py-1.5 text-sm focus:border-brand focus:outline-none"
                  />
                  <button
                    type="button"
                    onClick={() => handleSaveRename(g.id)}
                    disabled={pending}
                    className="rounded-md bg-brand px-3 py-1.5 text-xs font-semibold text-white hover:bg-brand-dark disabled:opacity-60"
                  >
                    Save
                  </button>
                  <button
                    type="button"
                    onClick={() => setEditingId(null)}
                    className="rounded-md bg-[#f0f0f0] px-3 py-1.5 text-xs font-semibold text-[#333] hover:bg-[#e0e0e0]"
                  >
                    Cancel
                  </button>
                </>
              ) : (
                <>
                  <span className="flex-1 min-w-0 truncate text-sm text-[#333]">{g.name}</span>
                  {colorDot(g.id, g.qr_color ?? servantsQrColor, g.name)}
                  <button
                    type="button"
                    onClick={() => startEdit(g)}
                    className="rounded-md bg-[#f0f0f0] px-3 py-1.5 text-xs font-semibold text-[#333] hover:bg-[#e0e0e0]"
                  >
                    Rename
                  </button>
                  {!isPreEntry && !isTerminal ? (
                    <button
                      type="button"
                      onClick={() => handleDelete(g)}
                      disabled={pending}
                      className="rounded-md bg-white px-3 py-1.5 text-xs font-semibold text-[#dc3545] border border-[#dc3545] hover:bg-[#f8d7da] disabled:opacity-60"
                    >
                      Delete
                    </button>
                  ) : (
                    deletePlaceholder
                  )}
                </>
              )}
            </div>
          );
        })}
      </div>

      {showAddForm ? (
        <div className="rounded-md border border-[#ddd] p-3 space-y-2">
          <p className="text-xs text-[#666]">
            Adds a new active tier just below the current terminal group, which shifts up to make room (e.g.{" "}
            {positionLabel} 5+ becomes {positionLabel} 6+).
          </p>
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-2">
            <label className="text-xs text-[#666]">
              {groupLabel} year (optional)
              <input
                type="number"
                value={addForm.cohortYear ?? ""}
                onChange={(e) => setAddForm((prev) => ({ ...prev, cohortYear: e.target.value === "" ? null : Number(e.target.value) }))}
                className="mt-1 w-full rounded-md border border-[#ddd] px-2 py-1.5 text-sm focus:border-brand focus:outline-none"
              />
            </label>
            <label className="text-xs text-[#666]">
              Name (required)
              <input
                value={addForm.name}
                onChange={(e) => setAddForm((prev) => ({ ...prev, name: e.target.value }))}
                className="mt-1 w-full rounded-md border border-[#ddd] px-2 py-1.5 text-sm focus:border-brand focus:outline-none"
              />
            </label>
            <label className="text-xs text-[#666]">
              QR Color
              <input
                type="color"
                value={addForm.qrColor}
                onChange={(e) => setAddForm((prev) => ({ ...prev, qrColor: e.target.value }))}
                className="mt-1 h-9 w-full rounded-md border border-[#ddd] px-2 py-1 focus:border-brand focus:outline-none"
              />
            </label>
          </div>
          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={handleAdd}
              disabled={pending}
              className="rounded-md bg-brand px-4 py-1.5 text-xs font-semibold text-white hover:bg-brand-dark disabled:opacity-60"
            >
              {pending ? "Adding…" : "Add Group"}
            </button>
            <button
              type="button"
              onClick={() => setShowAddForm(false)}
              className="rounded-md bg-[#f0f0f0] px-4 py-1.5 text-xs font-semibold text-[#333] hover:bg-[#e0e0e0]"
            >
              Cancel
            </button>
          </div>
        </div>
      ) : (
        <button
          type="button"
          onClick={() => setShowAddForm(true)}
          className="rounded-md bg-brand px-4 py-1.5 text-xs font-semibold text-white hover:bg-brand-dark"
        >
          + Add Group
        </button>
      )}

      <div className="mt-4 border-t border-[#f0f0f0] py-2 flex items-center gap-3">
        <span className="w-14 shrink-0" />
        <span className="flex-1 min-w-0 truncate text-sm text-[#333]">Servants</span>
        {colorDot(SERVANTS, servantsQrColor, "the Servants QR")}
        {renamePlaceholder}
        {deletePlaceholder}
      </div>
    </div>
  );
}
