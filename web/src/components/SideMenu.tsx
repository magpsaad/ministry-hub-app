"use client";

import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import { createPortal } from "react-dom";
import { logGroupSelectedAction } from "@/app/actions";
import { ChevronDownIcon, CloseIcon, SpinnerIcon } from "@/components/icons";
import { SignOutButton } from "@/components/SignOutButton";
import { LAST_GROUP_COOKIE } from "@/lib/allCohorts";
import type { MenuData } from "@/lib/menu-types";

// Owner-requested: entries indented under their corner heading.
const ITEM = "block w-full text-left pl-9 pr-5 py-2.5 text-sm text-[#333] hover:bg-[#f5f5f5] disabled:opacity-60";

/**
 * SIDE_MENU_PLAN.md §3.2 -- the side menu drawer. Its own file so pages
 * don't carry its code until it's needed: MenuButton loads it lazily
 * (and preloads it in the background once the page settles).
 */
export function SideMenu({ data, onClose }: { data: MenuData | null; onClose: () => void }) {
  const pathname = usePathname();
  const router = useRouter();
  const [switcherOpen, setSwitcherOpen] = useState(false);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && onClose();
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    window.addEventListener("keydown", onKey);
    return () => {
      document.body.style.overflow = previousOverflow;
      window.removeEventListener("keydown", onKey);
    };
  }, [onClose]);

  const currentGroupId = pathname.match(/^\/g\/([^/]+)/)?.[1] ?? null;
  const cohorts = data?.cohorts ?? [];
  // Owner-requested (revises SIDE_MENU_PLAN.md D8): the cohort row shows
  // for everyone with a cohort, even a single-cohort servant, as an obvious
  // way back to their Dashboard. The arrow (full list) only appears when
  // there's somewhere else to go, or no default to go to.
  // Owner-requested: nobody ever sees "Choose a cohort" -- the default
  // (pickDefaultGroupId) always exists for anyone with a cohort; the first
  // one listed is only a safety net.
  const defaultEntry = cohorts.find((c) => c.id === data?.defaultCohortId) ?? cohorts[0];
  const showArrow = cohorts.length > 1;

  function selectCohort(id: string) {
    onClose();
    if (pathname === `/g/${id}/dashboard`) return;
    if (id !== currentGroupId) {
      // Remembered in the browser, not by the server action: setting a
      // cookie from a server action makes Next.js re-render the whole
      // current page first, slowing the switch.
      document.cookie = `${LAST_GROUP_COOKIE}=${id}; path=/; max-age=31536000; samesite=lax; secure`;
      void logGroupSelectedAction(id);
    }
    router.push(`/g/${id}/dashboard`);
  }

  const link = (href: string, label: React.ReactNode) => (
    <Link href={href} onClick={onClose} className={ITEM}>
      {label}
    </Link>
  );

  // Portaled to <body>: every page header is sticky with its own z-index,
  // which would otherwise trap this overlay underneath the page content.
  // z-[60] sits above the headers (z-40) and QA banner (z-50) but under the
  // Service Calendar (z-[70]), which opens from inside this menu.
  return createPortal(
    <div className="fixed inset-0 z-[60] flex" role="dialog" aria-modal="true" aria-label="Menu">
      <div className="absolute inset-0 bg-black/40" onClick={onClose} />
      {/* [&>*]:shrink-0 -- owner-reported: without it, once the menu is
          taller than the screen (always, for an Admin) the flex column
          squeezed the cohort switcher down to an invisible sliver. */}
      <nav className="relative h-full w-72 max-w-[85vw] bg-white shadow-[4px_0_20px_rgba(0,0,0,0.15)] flex flex-col overflow-y-auto [&>*]:shrink-0">
        <div className="bg-gradient-to-br from-brand to-brand-light text-white px-5 py-4 flex items-center justify-between shrink-0">
          <span className="text-base font-semibold">Menu</span>
          <button type="button" onClick={onClose} aria-label="Close menu" className="text-white/80 hover:text-white">
            <CloseIcon className="h-6 w-6" />
          </button>
        </div>

        {!data ? (
          <div className="flex justify-center py-10 text-brand">
            <SpinnerIcon className="h-8 w-8" />
          </div>
        ) : (
          <>
            {/* Owner-requested: the row shows the person's DEFAULT cohort
                (where `/` lands them; Combined for a General Coordinator),
                not whichever page they're on. Tapping the name goes to its
                Dashboard; the arrow opens the full list. */}
            {defaultEntry && (
              <div className="m-3 rounded-lg border border-brand/30 bg-brand/5 overflow-hidden">
                <div className="flex items-stretch">
                  <button
                    type="button"
                    onClick={() => selectCohort(defaultEntry.id)}
                    className="flex-1 min-w-0 flex items-center gap-2 px-3 py-2.5 text-sm font-semibold text-brand text-left hover:bg-brand/10"
                  >
                    <span className="truncate">{defaultEntry.name}</span>
                    <span className="ml-auto text-[11px] font-medium text-brand/80 shrink-0">Dashboard ›</span>
                  </button>
                  {showArrow && (
                    <button
                      type="button"
                      onClick={() => setSwitcherOpen((o) => !o)}
                      aria-expanded={switcherOpen}
                      aria-label={`Show all ${data.groupLabel.toLowerCase()}s`}
                      className="px-3 border-l border-brand/20 text-brand hover:bg-brand/10"
                    >
                      <ChevronDownIcon className={`h-4 w-4 transition-transform ${switcherOpen ? "rotate-180" : ""}`} />
                    </button>
                  )}
                </div>
                {switcherOpen &&
                  cohorts.map((c) => (
                    <button
                      key={c.id}
                      type="button"
                      onClick={() => selectCohort(c.id)}
                      className={`w-full flex items-center justify-between gap-2 px-3 py-2 text-sm border-t border-brand/20 text-left ${
                        c.id === currentGroupId ? "bg-brand/15 font-semibold text-brand" : "text-[#333] hover:bg-brand/10"
                      }`}
                    >
                      <span className="truncate">{c.name}</span>
                      {c.tag && <span className="text-[11px] text-brand/80 shrink-0">{c.tag}</span>}
                    </button>
                  ))}
              </div>
            )}

            <Section title="Servant Corner">
              {link("/servants-directory", "Servant Directory")}
              {link("/calendar", "Service Calendar")}
              {link("/qr-codes", "Checkin - QR Codes")}
              {link("/version-control", "Release History")}
            </Section>

            {data.isCoordinator && (
              <Section title="Coordinator Corner">
                {link("/servant-profiles", "Servant Profiles")}
                {link("/servant-assignments", "Servant Assignments")}
                {link("/servants-attendance", "Servant Attendance")}
                {link("/export-lists", "Print/Export Lists")}
                {data.isAdminOrGeneralCoordinator &&
                  link(
                    "/admin/pending-servants",
                    <span className="flex items-center gap-2">
                      Pending Servants
                      {data.pendingServantsCount > 0 && (
                        <span className="rounded-full bg-[#dc3545] text-white text-[11px] px-2 py-0.5">
                          {data.pendingServantsCount}
                        </span>
                      )}
                    </span>,
                  )}
              </Section>
            )}

            {data.isAdmin && (
              <Section title="System Admin Corner">
                {link("/admin/access-maintenance", "Access Maintenance")}
                {link("/admin/universities-maintenance", `${data.universityLabel} Maintenance`)}
                {link("/admin/calendar-maintenance", "Calendar Maintenance")}
                {link("/admin/verses-maintenance", "Verses Maintenance")}
                {link("/admin/actions-needed-config", "App Settings")}
                {link("/admin/group-transition", "Group Transition")}
                {link("/admin/audit-logs", "Audit Logs")}
                {link("/admin/audit-report", "Audit Report")}
              </Section>
            )}

            <div className="mt-auto border-t border-[#eee] px-5 py-3 flex items-center justify-between">
              <span className="text-[11px] text-[#888]">Version {data.appVersion}</span>
              <SignOutButton className="text-[#666] hover:text-brand transition-colors" />
            </div>
          </>
        )}
      </nav>
    </div>,
    document.body,
  );
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div className="py-1">
      {/* Owner-requested: headings stand out from their entries. */}
      <p className="mx-3 mb-1 rounded-md bg-brand/10 px-3 py-1.5 text-xs font-bold uppercase tracking-wide text-brand">
        {title}
      </p>
      {children}
    </div>
  );
}
