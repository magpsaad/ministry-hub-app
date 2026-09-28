/** REQUIREMENTS.md §8.1 -- "skeleton loading states" enhancement: a plain
 * content-shaped placeholder block, used to build page-specific `loading.tsx`
 * files instead of a spinner or a blank gap. Each route's own loading.tsx
 * composes these into a rough approximation of that page's real layout, so
 * the transition from skeleton to real content doesn't jump around. */
export function Skeleton({ className = "" }: { className?: string }) {
  return <div className={`animate-pulse rounded-md bg-[#e8e8e8] ${className}`} />;
}

/** A skeleton matching the common "white card, navy top border, label +
 * big number" StatCard shape used across Dashboard/Analytics. */
export function StatCardSkeleton() {
  return (
    <div className="bg-white rounded-xl shadow-[0_4px_20px_rgba(0,0,0,0.06)] border-t-4 border-[#e8e8e8] p-4">
      <Skeleton className="h-2.5 w-20 mb-3" />
      <Skeleton className="h-7 w-12" />
    </div>
  );
}

/** A skeleton matching the common white card section wrapper. */
export function CardSkeleton({ children, className = "" }: { children: React.ReactNode; className?: string }) {
  return (
    <div className={`bg-white rounded-xl shadow-[0_4px_20px_rgba(0,0,0,0.06)] p-5 ${className}`}>{children}</div>
  );
}

/** A rough header-shaped placeholder for the handful of standalone screens
 * (Servant Profiles/Assignments/Directory/Attendance) that render their own
 * header directly in page.tsx rather than a shared layout -- for those,
 * loading.tsx replaces the whole page, header included, so a header-shaped
 * block avoids a blank white top strip while data loads. */
export function HeaderSkeleton() {
  return (
    <div className="bg-gradient-to-br from-brand to-brand-light px-5 py-5 text-center shadow-[0_2px_10px_rgba(0,0,0,0.1)]">
      <div className="mx-auto h-6 w-40 rounded-md bg-white/20 animate-pulse" />
      <div className="mx-auto mt-2 h-3.5 w-24 rounded-md bg-white/15 animate-pulse" />
    </div>
  );
}

/** A skeleton row matching the common avatar + two lines of text card row
 * used throughout member/servant lists. */
export function RowSkeleton() {
  return (
    <div className="flex items-center gap-3 py-2.5">
      <Skeleton className="h-10 w-10 rounded-full shrink-0" />
      <div className="flex-1 min-w-0 space-y-2">
        <Skeleton className="h-3.5 w-1/3" />
        <Skeleton className="h-3 w-1/4" />
      </div>
    </div>
  );
}
