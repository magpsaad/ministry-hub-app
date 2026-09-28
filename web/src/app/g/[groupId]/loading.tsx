import { Skeleton, StatCardSkeleton, CardSkeleton, RowSkeleton } from "@/components/Skeleton";

/**
 * REQUIREMENTS.md §8.1 -- the skeleton loading states enhancement had a real
 * gap: `[groupId]/layout.tsx` (which renders GroupNavShell -- the header and
 * tab bar) does its own data fetching (group name, app settings, last
 * service date) and had no `loading.tsx` of its own. A route segment's
 * `loading.tsx` only wraps *that* segment; since the layout itself had none,
 * nothing at all could render -- not the header, not the tabs, not even
 * dashboard/loading.tsx's own skeleton -- until the layout's fetch finished.
 * The old landing page would just sit there with the "Load [Member] Data"
 * button's own "Loading…" text as the only feedback, however long that took
 * (owner-reported).
 *
 * This fixes that: a full shell-shaped skeleton (header, tab bar, the "My
 * Assigned List"/Last Service Date row, then a generic content skeleton)
 * shows the instant navigation into any group begins, regardless of which
 * tab. Since "Load [Member] Data" always lands on the Dashboard first, the
 * content skeleton below is shaped like Dashboard's own -- once the layout
 * resolves and the real nav shell renders, Dashboard's own loading.tsx (if
 * its own data is still pending) takes over seamlessly from a near-identical
 * skeleton, so the handoff isn't visually jarring.
 */
export default function GroupShellLoading() {
  return (
    <div className="min-h-full flex flex-col bg-[#f5f5f5]">
      {/* Sticky-header shape matches GroupNavShell's real one -- see the
          comment there -- so the handoff from skeleton to real shell has no
          visible jump once the layout's data resolves. */}
      <div className="sticky top-[var(--qa-banner-h)] z-40">
        <div className="bg-gradient-to-br from-brand to-brand-light px-5 py-5 text-center shadow-[0_2px_10px_rgba(0,0,0,0.1)]">
          <div className="mx-auto h-8 w-8 rounded-full bg-white/20 animate-pulse" />
          <div className="mx-auto mt-2 h-6 w-32 rounded-md bg-white/20 animate-pulse" />
          <div className="mx-auto mt-2 h-3.5 w-40 rounded-md bg-white/15 animate-pulse" />
        </div>

        <div className="flex bg-white border-b-2 border-[#ddd]">
          {Array.from({ length: 5 }).map((_, i) => (
            <div key={i} className="flex-1 py-3.5 flex items-center justify-center">
              <Skeleton className="h-3.5 w-14" />
            </div>
          ))}
        </div>
      </div>

      <div className="max-w-5xl w-full mx-auto px-4 py-3 flex items-center justify-between">
        <Skeleton className="h-4 w-32" />
        <Skeleton className="h-4 w-40" />
      </div>

      <main className="flex-1 max-w-5xl w-full mx-auto px-4 pb-8">
        <div className="mt-4 space-y-6">
          <CardSkeleton>
            <Skeleton className="h-5 w-28 mb-4" />
            <div className="grid grid-cols-2 sm:grid-cols-4 gap-4">
              <StatCardSkeleton />
              <StatCardSkeleton />
              <StatCardSkeleton />
              <StatCardSkeleton />
            </div>
          </CardSkeleton>
          <CardSkeleton>
            <Skeleton className="h-5 w-40 mb-4" />
            <div className="divide-y divide-[#f0f0f0]">
              <RowSkeleton />
              <RowSkeleton />
            </div>
          </CardSkeleton>
        </div>
      </main>
    </div>
  );
}
