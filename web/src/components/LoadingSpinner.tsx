import { SpinnerIcon } from "@/components/icons";

/** The page-loading spinner (owner-requested, 10 Oct 2026): a round badge in
 * the middle of the screen. Shown by NavigationSpinner the moment someone
 * moves to another page, and by every loading screen (loading.tsx) in the
 * same place, so it simply stays until the page is ready. Doesn't block
 * taps -- the header and tabs keep working underneath. */
export function LoadingSpinner() {
  return (
    <div
      role="status"
      aria-label="Loading"
      className="pointer-events-none fixed inset-0 z-[100] flex items-center justify-center"
    >
      <div className="rounded-full bg-white p-3 shadow-[0_4px_20px_rgba(0,0,0,0.18)]">
        <SpinnerIcon className="h-8 w-8 text-brand" />
      </div>
    </div>
  );
}
