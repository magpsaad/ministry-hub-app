"use client";

import Link from "next/link";
import { useSyncExternalStore } from "react";
import { LAST_GROUP_COOKIE } from "@/lib/allCohorts";
import type { MenuData } from "@/lib/menu-types";
import { getMenuDataServerSnapshot, getMenuDataSnapshot, subscribeMenuData } from "@/components/menuStore";

/** Where `/` would send this person: the last cohort they opened if it's
 * one they serve, else their default (same rule as pickDefaultGroupId). */
function homeHref(data: MenuData | null): string {
  if (!data || !Array.isArray(data.servingCohortIds)) return "/";
  const last = document.cookie
    .split("; ")
    .find((c) => c.startsWith(`${LAST_GROUP_COOKIE}=`))
    ?.slice(LAST_GROUP_COOKIE.length + 1);
  const id = last && data.servingCohortIds.includes(last) ? last : data.fallbackCohortId;
  return id ? `/g/${id}/dashboard` : "/";
}

/**
 * The header logo (owner-requested, 10 Oct 2026): it used to go to `/`,
 * which checks sign-in, profile and roles, notes an "App access" audit
 * entry, then sends the person on to their Dashboard -- two page loads.
 * It now goes straight to that Dashboard, worked out from the side menu's
 * data (already in the browser). Until that data is there, it still uses `/`.
 */
export function HomeLink({ className, children }: { className?: string; children: React.ReactNode }) {
  const data = useSyncExternalStore(subscribeMenuData, getMenuDataSnapshot, getMenuDataServerSnapshot);
  return (
    <Link href={homeHref(data)} className={className}>
      {children}
    </Link>
  );
}
