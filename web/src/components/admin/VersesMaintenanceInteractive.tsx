"use client";

import { useState, useTransition } from "react";
import type { Verse } from "@/app/admin/verses-maintenance/actions";
import {
  addVerseAction,
  updateVerseAction,
  toggleVerseActiveAction,
  deleteVerseAction,
} from "@/app/admin/verses-maintenance/actions";

export function VersesMaintenanceInteractive({ initial }: { initial: Verse[] }) {
  const [verses, setVerses] = useState(initial);
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editText, setEditText] = useState("");
  const [editReference, setEditReference] = useState("");

  const [newText, setNewText] = useState("");
  const [newReference, setNewReference] = useState("");

  function handleAdd() {
    setError(null);
    if (!newText.trim()) {
      setError("Verse text is required.");
      return;
    }
    startTransition(async () => {
      const res = await addVerseAction(newText.trim(), newReference.trim());
      if (res.error) {
        setError(res.error);
        return;
      }
      setVerses((prev) => [
        ...prev,
        { id: crypto.randomUUID(), text: newText.trim(), reference: newReference.trim() || null, is_active: true },
      ]);
      setNewText("");
      setNewReference("");
    });
  }

  function startEdit(v: Verse) {
    setEditingId(v.id);
    setEditText(v.text);
    setEditReference(v.reference ?? "");
  }

  function handleSaveEdit(id: string) {
    setError(null);
    startTransition(async () => {
      const res = await updateVerseAction(id, editText.trim(), editReference.trim());
      if (res.error) {
        setError(res.error);
        return;
      }
      setVerses((prev) =>
        prev.map((v) => (v.id === id ? { ...v, text: editText.trim(), reference: editReference.trim() || null } : v)),
      );
      setEditingId(null);
    });
  }

  function handleToggleActive(id: string, isActive: boolean) {
    setVerses((prev) => prev.map((v) => (v.id === id ? { ...v, is_active: isActive } : v)));
    startTransition(async () => {
      await toggleVerseActiveAction(id, isActive);
    });
  }

  function handleDelete(id: string) {
    if (!confirm("Delete this verse? This cannot be undone.")) return;
    setError(null);
    startTransition(async () => {
      const res = await deleteVerseAction(id);
      if (res.error) {
        setError(res.error);
        return;
      }
      setVerses((prev) => prev.filter((v) => v.id !== id));
    });
  }

  return (
    <div className="rounded-xl bg-white shadow-[0_4px_20px_rgba(0,0,0,0.06)] p-5">
      <h2 className="text-lg font-bold text-brand mb-1">Bible Verses</h2>
      <p className="text-sm text-[#666] mb-3">
        A random active verse is shown while a group&rsquo;s data loads. Uncheck a verse to keep it without showing it.
      </p>
      {error && <p className="mb-3 text-sm text-[#dc3545]">{error}</p>}

      <div className="divide-y divide-[#f0f0f0] mb-4">
        {verses.map((v) => (
          <div key={v.id} className="py-2 text-sm">
            {editingId === v.id ? (
              <div className="space-y-2">
                <textarea
                  value={editText}
                  onChange={(e) => setEditText(e.target.value)}
                  rows={2}
                  className="w-full rounded-md border border-[#ddd] px-2 py-1.5 text-sm focus:border-brand focus:outline-none"
                />
                <div className="flex items-center gap-2">
                  <input
                    type="text"
                    placeholder="Reference (e.g. John 3:16)"
                    value={editReference}
                    onChange={(e) => setEditReference(e.target.value)}
                    className="flex-1 rounded-md border border-[#ddd] px-2 py-1.5 text-sm focus:border-brand focus:outline-none"
                  />
                  <button
                    type="button"
                    onClick={() => handleSaveEdit(v.id)}
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
                <input
                  type="checkbox"
                  checked={v.is_active}
                  onChange={(e) => handleToggleActive(v.id, e.target.checked)}
                  className="mt-1"
                />
                <div className="flex-1 min-w-0">
                  <p className={v.is_active ? "text-[#333]" : "text-[#aaa] line-through"}>{v.text}</p>
                  {v.reference && <p className="text-xs text-[#666] mt-0.5">{v.reference}</p>}
                </div>
                <button type="button" onClick={() => startEdit(v)} className="text-brand text-xs font-semibold shrink-0">
                  Edit
                </button>
                <button
                  type="button"
                  onClick={() => handleDelete(v.id)}
                  disabled={pending}
                  className="text-[#dc3545] text-xs font-semibold shrink-0 disabled:opacity-60"
                >
                  Delete
                </button>
              </div>
            )}
          </div>
        ))}
        {verses.length === 0 && <p className="py-2 text-sm text-[#666]">No verses yet.</p>}
      </div>

      <div className="border-t border-[#f0f0f0] pt-3 space-y-2">
        <textarea
          placeholder="Verse text"
          value={newText}
          onChange={(e) => setNewText(e.target.value)}
          rows={2}
          className="w-full rounded-md border border-[#ddd] px-3 py-2 text-sm focus:border-brand focus:outline-none"
        />
        <div className="flex items-center gap-2">
          <input
            type="text"
            placeholder="Reference (e.g. John 3:16)"
            value={newReference}
            onChange={(e) => setNewReference(e.target.value)}
            className="flex-1 rounded-md border border-[#ddd] px-3 py-2 text-sm focus:border-brand focus:outline-none"
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
      </div>
    </div>
  );
}
