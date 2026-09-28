"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { logGroupSelectedAction } from "@/app/actions";
import { ALL_COHORTS_GROUP_ID } from "@/lib/allCohorts";

/** REQUIREMENTS.md §6.1 addendum -- Coordinator Corner's "Load Youth Data
 * for all cohorts": functions exactly like LoadGroupPanel's "Load [Member]
 * Data" button (same navigate-to-dashboard-and-log-the-selection behavior),
 * just with no group to pick -- it always targets the reserved
 * ALL_COHORTS_GROUP_ID route, which the group layout treats as "every
 * cohort this user can see" rather than one specific group. */
export function LoadAllCohortsButton({ memberLabel, groupLabel }: { memberLabel: string; groupLabel: string }) {
  const router = useRouter();
  const [loading, setLoading] = useState(false);

  function handleLoad() {
    setLoading(true);
    void logGroupSelectedAction(ALL_COHORTS_GROUP_ID);
    router.push(`/g/${ALL_COHORTS_GROUP_ID}/dashboard`);
  }

  return (
    <button
      onClick={handleLoad}
      disabled={loading}
      className="w-full rounded-md bg-brand px-4 py-3 text-sm font-semibold text-white text-center hover:bg-brand-dark disabled:opacity-60 shadow-[0_2px_4px_rgba(0,0,0,0.15)] transition-all hover:-translate-y-0.5 hover:shadow-[0_4px_8px_rgba(0,0,0,0.2)] active:translate-y-0 active:shadow-[0_1px_2px_rgba(0,0,0,0.15)]"
    >
      {loading ? "Loading…" : `Load ${memberLabel} Data for all ${groupLabel.toLowerCase()}s`}
    </button>
  );
}
