"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useState } from "react";
import { AppLogo } from "@/components/AppLogo";
import { MenuButton } from "@/components/MenuButton";
import { BackButton } from "@/components/BackButton";
import { RefreshButton } from "@/components/RefreshButton";
import { useMyAssigned } from "@/components/MyAssignedContext";
import { CohortFilterBar } from "@/components/CohortFilter";

const TABS = (memberLabel: string) => [
  { slug: "dashboard", label: "Dashboard" },
  { slug: "members", label: `${memberLabel} List` },
  { slug: "attendance", label: "Attendance" },
  { slug: "outreach", label: "Outreach" },
  { slug: "reports", label: "Analytics" },
];

export function GroupNavShell({
  groupId,
  groupName,
  appTitleShort,
  memberLabel,
  logoUrl,
  lastServiceDate,
  verse = null,
  combined = false,
  combinedGroups = [],
  groupLabel = "Group",
  children,
}: {
  groupId: string;
  groupName: string;
  appTitleShort: string;
  memberLabel: string;
  logoUrl: string | null;
  lastServiceDate: string | null;
  /** SIDE_MENU_PLAN.md D9/Q2 -- the Bible verse that used to sit on the
   * landing page: one small line along the banner's bottom edge (the
   * banner is sticky, so a full verse would permanently eat phone screen);
   * tapping it shows the whole verse. */
  verse?: { text: string; reference: string | null } | null;
  /** The combined ("all cohorts") view. Owner-requested (30 Sep 2026): it
   * shows "My Assigned List" too, plus the cohort checkboxes, which every
   * tab follows (CohortFilter). */
  combined?: boolean;
  /** The combined view's groups, for the cohort checkboxes. */
  combinedGroups?: { id: string; name: string }[];
  groupLabel?: string;
  children: React.ReactNode;
}) {
  const pathname = usePathname();
  const { myAssignedOnly, toggle, hydrated } = useMyAssigned();
  const filtered = hydrated && myAssignedOnly;
  const [verseExpanded, setVerseExpanded] = useState(false);

  return (
    <div className="min-h-full flex flex-col bg-[#f5f5f5]">
      {/* Owner-requested: sticky page headers -- on the group pages, "the
          header" for stickiness purposes means the branding bar AND the tab
          bar together (the "top menu options"), so both are wrapped in one
          sticky block rather than just the branding bar alone. The "My
          Assigned List"/Last Service Date row and the content below stay in
          normal flow and scroll away as before. `top` sits right beneath
          the QA banner (0px on prod, where it doesn't exist) -- see
          globals.css/QaEnvBanner.tsx. z-40 keeps it under every modal
          (lowest is z-50) and under the banner itself (z-50). */}
      <div className="sticky top-[var(--qa-banner-h)] z-40">
        <header
          className={`text-white px-5 py-5 text-center shadow-[0_2px_10px_rgba(0,0,0,0.1)] relative transition-colors ${
            filtered
              ? "bg-gradient-to-br from-my-assigned to-my-assigned-light"
              : "bg-gradient-to-br from-brand to-brand-light"
          }`}
        >
          <Link href="/" className="inline-flex items-center justify-center gap-2 hover:opacity-90 transition-opacity">
            <AppLogo logoUrl={logoUrl} title={appTitleShort} size={32} circular={false} />
            <h1 className="text-2xl font-bold">{appTitleShort}</h1>
          </Link>
          <p className="mt-1 text-sm opacity-90">{groupName}</p>
          {verse && (
            <button
              type="button"
              onClick={() => setVerseExpanded((v) => !v)}
              aria-expanded={verseExpanded}
              title={verseExpanded ? "Show less" : "Show the whole verse"}
              className={`mt-1.5 -mb-2 block w-full max-w-2xl mx-auto text-[11px] italic text-[#ffd54f] hover:text-[#ffe082] ${
                verseExpanded ? "whitespace-normal" : "truncate"
              }`}
            >
              &ldquo;{verse.text}&rdquo;{verse.reference && <span className="not-italic"> — {verse.reference}</span>}
            </button>
          )}

          <div className="absolute top-2.5 right-4">
            <RefreshButton />
          </div>

          <div className="absolute top-2.5 left-4 flex flex-col items-start gap-1">
            <MenuButton />
            <BackButton />
          </div>
        </header>

        <nav className="flex bg-white border-b-2 border-[#ddd] overflow-x-auto">
          {TABS(memberLabel).map((tab) => {
            const href = `/g/${groupId}/${tab.slug}`;
            const active = pathname === href;
            return (
              <Link
                key={tab.slug}
                href={href}
                className={`flex-1 min-w-[100px] text-center px-2.5 py-3.5 text-sm font-medium border-b-[3px] transition-colors whitespace-nowrap ${
                  active
                    ? "text-brand border-brand"
                    : "text-[#666] border-transparent hover:bg-[#f9f9f9]"
                }`}
              >
                {tab.label}
              </Link>
            );
          })}
        </nav>
      </div>

      <div className="max-w-5xl w-full mx-auto px-4 py-3 flex items-center flex-wrap gap-2 justify-between">
        <label className="inline-flex items-center gap-2 text-sm text-[#333]">
          <input type="checkbox" checked={filtered} onChange={toggle} className="accent-brand" />
          My Assigned List
        </label>
        <span className="text-sm text-[#666]">
          Last Service Date:{" "}
          {lastServiceDate
            ? new Date(lastServiceDate + "T00:00:00").toLocaleDateString("en-US", {
                month: "2-digit",
                day: "2-digit",
                year: "numeric",
              })
            : "N/A"}
        </span>
        {combined && (
          <div className="w-full">
            <CohortFilterBar groups={combinedGroups} groupLabel={groupLabel} />
          </div>
        )}
      </div>

      <main className="flex-1 max-w-5xl w-full mx-auto px-4 pb-8">{children}</main>
    </div>
  );
}
