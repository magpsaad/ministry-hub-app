import type { RoleLabels } from "@/lib/role-labels";

/** The owner's rule (8 Oct 2026): say plainly who else can read
 * conversations here, per the ministry's setting (0102). */
export function OversightNote({ oversight, labels: L }: { oversight: "gc" | "gc_admin" | "none"; labels: RoleLabels }) {
  if (oversight === "none") return null;
  return (
    <p className="text-center text-xs text-[#888]">
      {oversight === "gc_admin" ? `${L.generalCoordinators} and System Admins` : L.generalCoordinators} can read conversations in
      this ministry.
    </p>
  );
}
