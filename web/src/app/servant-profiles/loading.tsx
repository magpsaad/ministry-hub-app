import { Skeleton, HeaderSkeleton, CardSkeleton, RowSkeleton } from "@/components/Skeleton";
import { LoadingSpinner } from "@/components/LoadingSpinner";

export default function ServantProfilesLoading() {
  return (
    <div className="min-h-full bg-[#f5f5f5]">
      <HeaderSkeleton />
      <main className="max-w-4xl mx-auto px-4 py-6 space-y-4">
        <Skeleton className="h-10 w-full" />
        <CardSkeleton>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
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
