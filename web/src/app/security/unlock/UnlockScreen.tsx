"use client";

import { UnlockPanel } from "@/components/UnlockPanel";

export function UnlockScreen({ next }: { next: string }) {
  return (
    <div className="min-h-full flex items-center justify-center bg-[#f5f5f5] px-4 py-10">
      <UnlockPanel onUnlocked={() => window.location.replace(next)} />
    </div>
  );
}
