"use client";

import dynamic from "next/dynamic";
import { usePathname, useRouter } from "next/navigation";
import { useEffect, useState, useSyncExternalStore } from "react";
import { MenuIcon } from "@/components/icons";
import {
  getMenuDataServerSnapshot,
  getMenuDataSnapshot,
  refreshMenuData,
  subscribeMenuData,
} from "@/components/menuStore";
import { startNavigationSpinner } from "@/components/NavigationSpinner";

const loadSideMenu = () => import("@/components/SideMenu").then((m) => m.SideMenu);
const SideMenu = dynamic(loadSideMenu, { ssr: false });

/**
 * SIDE_MENU_PLAN.md §3.2 -- the burger button in every page header, which
 * replaced the old Home button and landing page.
 *
 * Owner-reported: the menu took too long to appear. So once the page has
 * settled (browser idle), this quietly preloads both the menu's code and
 * its data (menuStore), once per page load and never in the way of the
 * page itself. By the time the burger is tapped the menu opens instantly
 * from that copy, and refreshes in the background.
 */
export function MenuButton() {
  const router = useRouter();
  const pathname = usePathname();
  const [open, setOpen] = useState(false);
  const data = useSyncExternalStore(subscribeMenuData, getMenuDataSnapshot, getMenuDataServerSnapshot);

  useEffect(() => {
    // QR check-in pages: most people there aren't signed in, so loading the
    // menu in the background is a wasted server call (owner-requested,
    // 11 Oct 2026). It still loads when the button is tapped.
    if (pathname.startsWith("/checkin")) return;
    const preload = () => {
      void loadSideMenu();
      void refreshMenuData();
    };
    // Safari has no requestIdleCallback; a short delay does the same job.
    if ("requestIdleCallback" in window) {
      const id = window.requestIdleCallback(preload, { timeout: 3000 });
      return () => window.cancelIdleCallback(id);
    }
    const id = setTimeout(preload, 1500);
    return () => clearTimeout(id);
  }, [pathname]);

  function handleOpen() {
    setOpen(true);
    void refreshMenuData({ force: true }).then((result) => {
      // Not signed in (e.g. on the Servants check-in page): behave like the
      // old Home button, which sent them on to sign-in.
      if (result === "signed-out") {
        setOpen(false);
        startNavigationSpinner();
        router.push("/");
      }
    });
  }

  return (
    <>
      <button
        type="button"
        onClick={handleOpen}
        onPointerEnter={() => void loadSideMenu()}
        title="Menu"
        aria-label="Menu"
        aria-expanded={open}
        className="inline-flex items-center gap-1 text-white/70 hover:text-white transition-colors"
      >
        <MenuIcon className="h-8 w-8" />
        <span className="text-xs font-medium">Menu</span>
      </button>
      {open && <SideMenu data={data} onClose={() => setOpen(false)} />}
    </>
  );
}
