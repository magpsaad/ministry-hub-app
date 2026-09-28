"use client";

import { useState, useTransition } from "react";
import type { University } from "@/lib/universities";
import { addUniversityAction, updateUniversityAction, deleteUniversityAction } from "@/app/admin/universities-maintenance/actions";

const PROXIMITIES = ["Local", "Regional", "Abroad", "Unknown"] as const;

export function UniversitiesMaintenanceInteractive({
  initial,
  label,
  proximityEnabled,
}: {
  initial: University[];
  label: string;
  proximityEnabled: boolean;
}) {
  const labelLower = label.toLowerCase();
  const [rows, setRows] = useState(initial);
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editName, setEditName] = useState("");
  const [editProximity, setEditProximity] = useState<string>("Local");

  const [newName, setNewName] = useState("");
  const [newProximity, setNewProximity] = useState<string>("Local");

  function handleAdd() {
    setError(null);
    if (!newName.trim()) {
      setError("Name is required.");
      return;
    }
    startTransition(async () => {
      const res = await addUniversityAction(newName.trim(), newProximity);
      if (res.error) {
        setError(res.error);
        return;
      }
      setRows((prev) =>
        [...prev, { id: crypto.randomUUID(), name: newName.trim(), proximity: newProximity as University["proximity"] }].sort(
          (a, b) => a.name.localeCompare(b.name),
        ),
      );
      setNewName("");
    });
  }

  function startEdit(u: University) {
    setEditingId(u.id);
    setEditName(u.name);
    setEditProximity(u.proximity);
  }

  function handleSaveEdit(id: string) {
    setError(null);
    startTransition(async () => {
      const res = await updateUniversityAction(id, editName.trim(), editProximity);
      if (res.error) {
        setError(res.error);
        return;
      }
      setRows((prev) =>
        prev.map((r) => (r.id === id ? { ...r, name: editName.trim(), proximity: editProximity as University["proximity"] } : r)),
      );
      setEditingId(null);
    });
  }

  function handleDelete(id: string) {
    if (!confirm(`Delete this ${labelLower}? This cannot be undone.`)) return;
    setError(null);
    startTransition(async () => {
      const res = await deleteUniversityAction(id);
      if (res.error) {
        setError(res.error);
        return;
      }
      setRows((prev) => prev.filter((r) => r.id !== id));
    });
  }

  return (
    <div className="rounded-xl bg-white shadow-[0_4px_20px_rgba(0,0,0,0.06)] p-5">
      <h2 className="text-lg font-bold text-brand mb-3">{label} List</h2>
      {error && <p className="mb-3 text-sm text-[#dc3545]">{error}</p>}

      <div className="divide-y divide-[#f0f0f0] mb-4">
        {rows.map((u) => (
          <div key={u.id} className="py-2 flex items-center gap-3 text-sm">
            {editingId === u.id ? (
              <>
                <input
                  type="text"
                  value={editName}
                  onChange={(e) => setEditName(e.target.value)}
                  className="flex-1 rounded-md border border-[#ddd] px-2 py-1.5 text-sm focus:border-brand focus:outline-none"
                />
                {proximityEnabled && (
                  <select
                    value={editProximity}
                    onChange={(e) => setEditProximity(e.target.value)}
                    className="rounded-md border border-[#ddd] px-2 py-1.5 text-sm focus:border-brand focus:outline-none"
                  >
                    {PROXIMITIES.map((p) => (
                      <option key={p} value={p}>
                        {p}
                      </option>
                    ))}
                  </select>
                )}
                <button
                  type="button"
                  onClick={() => handleSaveEdit(u.id)}
                  disabled={pending}
                  className="text-[#155724] text-xs font-semibold disabled:opacity-60"
                >
                  Save
                </button>
                <button type="button" onClick={() => setEditingId(null)} className="text-[#666] text-xs font-semibold">
                  Cancel
                </button>
              </>
            ) : (
              <>
                <span className="flex-1 text-[#333]">{u.name}</span>
                {proximityEnabled && <span className="text-xs text-[#666] w-20">{u.proximity}</span>}
                <button type="button" onClick={() => startEdit(u)} className="text-brand text-xs font-semibold">
                  Edit
                </button>
                <button
                  type="button"
                  onClick={() => handleDelete(u.id)}
                  disabled={pending}
                  className="text-[#dc3545] text-xs font-semibold disabled:opacity-60"
                >
                  Delete
                </button>
              </>
            )}
          </div>
        ))}
        {rows.length === 0 && <p className="py-2 text-sm text-[#666]">Nothing here yet.</p>}
      </div>

      <div className="border-t border-[#f0f0f0] pt-3 flex flex-wrap items-center gap-2">
        <input
          type="text"
          placeholder={`New ${labelLower} name`}
          value={newName}
          onChange={(e) => setNewName(e.target.value)}
          className="flex-1 min-w-[160px] rounded-md border border-[#ddd] px-3 py-2 text-sm focus:border-brand focus:outline-none"
        />
        {proximityEnabled && (
          <select
            value={newProximity}
            onChange={(e) => setNewProximity(e.target.value)}
            className="rounded-md border border-[#ddd] px-2 py-2 text-sm focus:border-brand focus:outline-none"
          >
            {PROXIMITIES.map((p) => (
              <option key={p} value={p}>
                {p}
              </option>
            ))}
          </select>
        )}
        <button
          type="button"
          onClick={handleAdd}
          disabled={pending}
          className="rounded-md bg-brand px-4 py-2 text-sm font-semibold text-white hover:bg-brand-dark disabled:opacity-60 shadow-[0_2px_4px_rgba(0,0,0,0.15)] transition-all hover:-translate-y-0.5 hover:shadow-[0_4px_8px_rgba(0,0,0,0.2)] active:translate-y-0 active:shadow-[0_1px_2px_rgba(0,0,0,0.15)]"
        >
          Add
        </button>
      </div>
    </div>
  );
}
