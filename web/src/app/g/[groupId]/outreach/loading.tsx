import { Skeleton, CardSkeleton, RowSkeleton } from "@/components/Skeleton";
import { LoadingSpinner } from "@/components/LoadingSpinner";

export default function OutreachLoading() {
  return (
    <div className="mt-4 space-y-4">
      <div className="flex flex-wrap items-center gap-2">
        <Skeleton className="h-10 flex-1 min-w-[140px]" />
        <Skeleton className="h-10 w-32" />
        <Skeleton className="h-10 w-32" />
        <Skeleton className="h-10 w-32" />
      </div>
      <CardSkeleton>
        <div className="divide-y divide-[#f0f0f0]">
          {Array.from({ length: 6 }).map((_, i) => (
            <RowSkeleton key={i} />
          ))}
        </div>
      </CardSkeleton>
      <LoadingSpinner />
    </div>
  );
}
