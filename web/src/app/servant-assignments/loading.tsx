import { Skeleton, HeaderSkeleton, CardSkeleton, RowSkeleton } from "@/components/Skeleton";
import { LoadingSpinner } from "@/components/LoadingSpinner";

export default function ServantAssignmentsLoading() {
  return (
    <div className="min-h-full bg-[#f5f5f5]">
      <HeaderSkeleton />
      <main className="max-w-3xl mx-auto px-4 py-6 space-y-4">
        <Skeleton className="h-10 w-full" />
        <CardSkeleton>
          <Skeleton className="h-4 w-24 mb-3" />
          <div className="divide-y divide-[#f0f0f0]">
            {Array.from({ length: 4 }).map((_, i) => (
              <RowSkeleton key={i} />
            ))}
          </div>
        </CardSkeleton>
      </main>
      <LoadingSpinner />
    </div>
  );
}
