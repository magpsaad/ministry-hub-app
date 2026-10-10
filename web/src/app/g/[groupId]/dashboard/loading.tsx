import { Skeleton, StatCardSkeleton, CardSkeleton, RowSkeleton } from "@/components/Skeleton";
import { LoadingSpinner } from "@/components/LoadingSpinner";

export default function DashboardLoading() {
  return (
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
        <Skeleton className="h-5 w-24 mb-4" />
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

      <CardSkeleton>
        <Skeleton className="h-5 w-48 mb-4" />
        <div className="divide-y divide-[#f0f0f0]">
          <RowSkeleton />
          <RowSkeleton />
          <RowSkeleton />
        </div>
      </CardSkeleton>
      <LoadingSpinner />
    </div>
  );
}
