"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { logGroupSelectedAction } from "@/app/actions";
import type { GroupSummary } from "@/lib/groups";

/** REQUIREMENTS.md §6.1 -- no artificial delay here anymore (owner request):
 * this used to also fetch a random verse and pause ~1.4s so it was readable
 * before navigating, matching the old app's load time. The new app loads
 * fast enough that the pause was pure overhead with nothing to show for it
 * -- the verse is now a permanent landing-page fixture instead (see
 * app/page.tsx), unrelated to loading a group's data. */
export function LoadGroupPanel({
  groups,
  groupLabel,
  memberLabel,
}: {
  groups: GroupSummary[];
  groupLabel: string;
  memberLabel: string;
}) {
  const router = useRouter();
  const [selectedId, setSelectedId] = useState(groups[0]?.id ?? "");
  const [loading, setLoading] = useState(false);

  async function handleLoad() {
    if (!selectedId) return;
    setLoading(true);
    void logGroupSelectedAction(selectedId);
    router.push(`/g/${selectedId}/dashboard`);
  }

  if (groups.length === 0) {
    return (
      <p className="text-sm text-[#666]">
        No groups are available to you yet. Contact a System Admin for access.
      </p>
    );
  }

  return (
    <div className="space-y-3">
      <div className="flex items-center gap-2">
        <label htmlFor="group-select" className="text-sm font-semibold text-[#333] whitespace-nowrap">
          Select {groupLabel}
        </label>
        <select
          id="group-select"
          value={selectedId}
          onChange={(e) => setSelectedId(e.target.value)}
          disabled={loading}
          className="flex-1 min-w-0 rounded-md border border-[#ddd] px-2 py-2 text-sm focus:border-brand focus:outline-none focus:ring-2 focus:ring-brand/10"
        >
          {groups.map((g) => (
            <option key={g.id} value={g.id}>
              {g.name}
            </option>
          ))}
        </select>
      </div>

      <button
        onClick={handleLoad}
        disabled={loading}
        className="w-full rounded-md bg-brand py-3 text-sm font-semibold text-white hover:bg-brand-dark disabled:opacity-60 shadow-[0_2px_4px_rgba(0,0,0,0.15)] transition-all hover:-translate-y-0.5 hover:shadow-[0_4px_8px_rgba(0,0,0,0.2)] active:translate-y-0 active:shadow-[0_1px_2px_rgba(0,0,0,0.15)]"
      >
        {loading ? "Loading…" : `Load ${memberLabel} Data`}
      </button>
    </div>
  );
}
