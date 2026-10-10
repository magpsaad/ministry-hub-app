import { Skeleton, HeaderSkeleton, CardSkeleton } from "@/components/Skeleton";
import { LoadingSpinner } from "@/components/LoadingSpinner";

/** Shown while the Home page (and any other screen without its own
 * loading.tsx -- the admin screens, QR Codes, Export Lists, Version
 * Control) is loading, instead of a blank page. */
export default function RootLoading() {
  return (
    <div className="min-h-full bg-[#f5f5f5]">
      <HeaderSkeleton />
      <main className="max-w-2xl mx-auto px-4 py-6 space-y-4">
        <CardSkeleton>
          <Skeleton className="h-4 w-32 mb-3" />
          <Skeleton className="h-10 w-full" />
        </CardSkeleton>
        <CardSkeleton>
          <Skeleton className="h-4 w-40 mb-3" />
          <div className="grid grid-cols-2 gap-3">
            <Skeleton className="h-11 w-full" />
            <Skeleton className="h-11 w-full" />
            <Skeleton className="h-11 w-full" />
            <Skeleton className="h-11 w-full" />
          </div>
        </CardSkeleton>
      </main>
      <LoadingSpinner />
    </div>
  );
}
