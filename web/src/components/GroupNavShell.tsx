"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { AppLogo } from "@/components/AppLogo";
import { MenuButton } from "@/components/MenuButton";
import { RefreshButton } from "@/components/RefreshButton";
import { useMyAssigned } from "@/components/MyAssignedContext";
import { SignOutButton } from "@/components/SignOutButton";

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
  appVersion,
  lastServiceDate,
  combined = false,
  children,
}: {
  groupId: string;
  groupName: string;
  appTitleShort: string;
  memberLabel: string;
  logoUrl: string | null;
  appVersion: string;
  lastServiceDate: string | null;
  /** The "Load Youth Data for all cohorts" view (REQUIREMENTS.md §6.1
   * addendum) -- hides "My Assigned List" (owner-reported: doesn't apply
   * once multiple cohorts' data is combined; the group layout also doesn't
   * wrap this tree in MyAssignedProvider in this case, so every screen's
   * own useMyAssigned() call already resolves to permanently-off regardless
   * of this prop -- this just keeps the now-inert control from showing). */
  combined?: boolean;
  children: React.ReactNode;
}) {
  const pathname = usePathname();
  const { myAssignedOnly, toggle, hydrated } = useMyAssigned();
  const filtered = hydrated && myAssignedOnly;

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

          <div className="absolute top-2.5 right-4 flex flex-col items-end gap-1">
            <SignOutButton className="text-white/70 hover:text-white transition-colors" />
            <span className="text-[10px] text-white/60">Version {appVersion}</span>
          </div>

          <div className="absolute top-2.5 left-4 flex flex-col items-start gap-1">
            <MenuButton />
            <RefreshButton />
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

      <div className={`max-w-5xl w-full mx-auto px-4 py-3 flex items-center flex-wrap gap-2 ${combined ? "justify-end" : "justify-between"}`}>
        {!combined && (
          <label className="inline-flex items-center gap-2 text-sm text-[#333]">
            <input type="checkbox" checked={filtered} onChange={toggle} className="accent-brand" />
            My Assigned List
          </label>
        )}
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
      </div>

      <main className="flex-1 max-w-5xl w-full mx-auto px-4 pb-8">{children}</main>
    </div>
  );
}
