import { Skeleton, HeaderSkeleton, CardSkeleton, RowSkeleton } from "@/components/Skeleton";
import { LoadingSpinner } from "@/components/LoadingSpinner";

/** Shown the moment a QR code is scanned, while the check-in list loads --
 * a phone on a slow connection used to see a blank page until then. */
export default function CheckInLoading() {
  return (
    <div className="min-h-full bg-[#f5f5f5]">
      <HeaderSkeleton />
      <main className="max-w-md mx-auto px-4 py-6">
        <CardSkeleton>
          <Skeleton className="h-10 w-full mb-3" />
          <div className="divide-y divide-[#f0f0f0]">
            {Array.from({ length: 5 }).map((_, i) => (
              <RowSkeleton key={i} />
            ))}
          </div>
        </CardSkeleton>
      </main>
      <LoadingSpinner />
    </div>
  );
}
