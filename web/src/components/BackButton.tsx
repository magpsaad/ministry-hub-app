"use client";

import { useRouter } from "next/navigation";
import { ArrowLeftIcon } from "@/components/icons";
import { startNavigationSpinner } from "@/components/NavigationSpinner";

/**
 * Owner-requested: sits below the Menu button in every page header, where
 * Refresh used to be (Refresh moved to the top right). Goes back to the
 * previous screen the way the browser's own Back does -- a client-side
 * navigation, no reload. With nothing to go back to (the app was just
 * opened in this tab), it goes to `/`, which lands on the person's own
 * Dashboard.
 */
export function BackButton() {
  const router = useRouter();

  function handleClick() {
    if (window.history.length > 1) router.back();
    else {
      startNavigationSpinner();
      router.push("/");
    }
  }

  return (
    <button
      type="button"
      onClick={handleClick}
      title="Back"
      aria-label="Back"
      className="inline-flex items-center gap-1 text-white/70 hover:text-white transition-colors"
    >
      <ArrowLeftIcon className="h-8 w-8" />
      <span className="text-xs font-medium">Back</span>
    </button>
  );
}
