import { Skeleton, RowSkeleton } from "@/components/Skeleton";
import { LoadingSpinner } from "@/components/LoadingSpinner";

export default function MembersLoading() {
  return (
    <div className="mt-4">
      <div className="flex gap-2 mb-4">
        <Skeleton className="h-10 flex-1" />
        <Skeleton className="h-10 w-24" />
      </div>
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
        {Array.from({ length: 8 }).map((_, i) => (
          <div key={i} className="bg-white rounded-xl shadow-[0_4px_20px_rgba(0,0,0,0.06)] border-l-4 border-[#e8e8e8] p-3">
            <RowSkeleton />
          </div>
        ))}
      </div>
      <LoadingSpinner />
    </div>
  );
}
