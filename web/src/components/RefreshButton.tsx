"use client";

import { useTransition } from "react";
import { useRouter } from "next/navigation";
import { RefreshIcon, SpinnerIcon } from "@/components/icons";

/**
 * Owner-requested: sits below the Home link in every page header. Cheap by
 * design -- clicking it just re-runs the same server-side data fetch that
 * already happens on every normal page load (`router.refresh()`, Next.js's
 * built-in "re-fetch this route's data without a full reload" primitive),
 * the exact same work a manual browser refresh or simply revisiting the
 * page would already trigger. No new class of load on the app: it's an
 * on-demand, per-click action a person has to actually press, not
 * something that polls or runs automatically.
 *
 * Owner-reported: nothing visibly happened between the click and the fresh
 * data arriving, so people clicked again and again. The refresh now runs
 * inside a transition -- the icon becomes a spinner and further clicks are
 * ignored until the data is back.
 *
 * Pass `onRefresh` for a screen that has its own reload callback instead
 * of the router-based default. If it returns a promise, the spinner lasts
 * until that resolves.
 */
export function RefreshButton({
  onRefresh,
  className,
}: {
  onRefresh?: () => void | Promise<void>;
  className?: string;
}) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();

  function handleClick() {
    if (pending) return;
    if (onRefresh) {
      startTransition(async () => {
        await onRefresh();
      });
    } else {
      startTransition(() => {
        router.refresh();
      });
    }
  }

  return (
    <button
      type="button"
      onClick={handleClick}
      aria-busy={pending}
      title="Refresh"
      aria-label="Refresh"
      className={className ?? "inline-flex items-center gap-1 text-white/70 hover:text-white transition-colors"}
    >
      {pending ? <SpinnerIcon className="h-8 w-8" /> : <RefreshIcon className="h-8 w-8" />}
      <span className="text-xs font-medium">Refresh</span>
    </button>
  );
}
