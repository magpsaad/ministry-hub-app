import { Skeleton, HeaderSkeleton, CardSkeleton, RowSkeleton } from "@/components/Skeleton";
import { LoadingSpinner } from "@/components/LoadingSpinner";

export default function ServantsAttendanceLoading() {
  return (
    <div className="min-h-full bg-[#f5f5f5]">
      <HeaderSkeleton />
      <main className="max-w-3xl mx-auto px-4 py-6 space-y-4">
        <div className="flex flex-wrap items-center gap-3">
          <Skeleton className="h-10 w-40" />
          <Skeleton className="h-10 flex-1 min-w-[140px]" />
        </div>
        <CardSkeleton>
          <div className="divide-y divide-[#f0f0f0]">
            {Array.from({ length: 6 }).map((_, i) => (
              <RowSkeleton key={i} />
            ))}
          </div>
        </CardSkeleton>
      </main>
      <LoadingSpinner />
    </div>
  );
}
