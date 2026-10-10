import { Skeleton, StatCardSkeleton, CardSkeleton, RowSkeleton } from "@/components/Skeleton";
import { LoadingSpinner } from "@/components/LoadingSpinner";

export default function ReportsLoading() {
  return (
    <div className="mt-4 space-y-6">
      <CardSkeleton>
        <Skeleton className="h-5 w-40 mb-4" />
        <div className="grid grid-cols-2 sm:grid-cols-3 gap-4">
          {Array.from({ length: 6 }).map((_, i) => (
            <StatCardSkeleton key={i} />
          ))}
        </div>
      </CardSkeleton>

      <CardSkeleton>
        <Skeleton className="h-5 w-44 mb-4" />
        <div className="divide-y divide-[#f0f0f0]">
          <RowSkeleton />
          <RowSkeleton />
          <RowSkeleton />
        </div>
      </CardSkeleton>

      <CardSkeleton>
        <Skeleton className="h-5 w-56 mb-4" />
        <div className="space-y-3">
          {Array.from({ length: 4 }).map((_, i) => (
            <Skeleton key={i} className="h-4 w-full" />
          ))}
        </div>
      </CardSkeleton>
      <LoadingSpinner />
    </div>
  );
}
