import type { RoleLabels } from "@/lib/role-labels";

/** Announcements (owner-approved design 8 Oct 2026, migration 0099). Types
 * and wording shared by the Announcements page, the Dashboard banner, the
 * Important pop-up and the console. */

export type AnnouncementRole = "servant" | "sub_coordinator" | "general_coordinator" | "admin" | "read_only";

/** One row of my_announcements(). */
export type AnnouncementRow = {
  id: string;
  title: string;
  body: string;
  link_url: string | null;
  importance: "normal" | "important";
  author_name: string;
  mine: boolean;
  created_at: string;
  updated_at: string;
  starts_on: string;
  ends_on: string;
  is_current: boolean;
  taken_down: boolean;
  for_me: boolean;
  seen: boolean;
  acknowledged: boolean;
  can_edit: boolean;
  roles: AnnouncementRole[] | null;
  servant_group_ids: string[] | null;
  coordinator_group_ids: string[] | null;
  include_youth: boolean;
  /** Important ones, for the poster / GCs / Admins: how many tapped "Got it". */
  ack_count: number | null;
  /** For the poster / GCs / Admins: how many people it's for. */
  audience_count: number | null;
};

/** One row of my_current_announcements() -- banners and pop-ups. */
export type CurrentAnnouncement = {
  id: string;
  title: string;
  body: string;
  link_url: string | null;
  importance: "normal" | "important";
  author_name: string;
};

/** The chips, in order. "System Admins" are the ministry's admin role --
 * named so they aren't confused with ministry leaders who hold Read-only or
 * unassigned Servant access. */
export function roleChips(L: RoleLabels): { role: AnnouncementRole; label: string }[] {
  return [
    { role: "servant", label: L.servants },
    { role: "sub_coordinator", label: L.coordinators },
    { role: "general_coordinator", label: L.generalCoordinators },
    { role: "admin", label: "System Admins" },
    { role: "read_only", label: "Read-only" },
  ];
}

/** "Everyone", "Servants of Gr12 Boys St. John; Coordinators", or "Youths
 * only" -- who in the app an announcement is for, in this ministry's
 * words. Youths at check-in are added separately (youthSummary): they
 * aren't app users and are never part of a people count. */
export function audienceSummary(
  a: Pick<AnnouncementRow, "roles" | "servant_group_ids" | "coordinator_group_ids" | "include_youth">,
  groupName: (id: string) => string,
  L: RoleLabels,
): string {
  if (!a.roles) return "Everyone";
  if (a.roles.length === 0) return "Youths only";
  const names = (ids: string[] | null) => (ids && ids.length ? ` of ${ids.map(groupName).join(", ")}` : "");
  const parts = roleChips(L)
    .filter((c) => a.roles!.includes(c.role))
    .map((c) =>
      c.role === "servant"
        ? `${c.label}${names(a.servant_group_ids)}`
        : c.role === "sub_coordinator"
          ? `${c.label}${names(a.coordinator_group_ids)}`
          : c.label,
    );
  return parts.join("; ");
}

/** "youths at check-in" / "youths of Gr12 Boys St. John at check-in", or ""
 * when youths aren't included. */
export function youthSummary(
  a: Pick<AnnouncementRow, "servant_group_ids" | "include_youth">,
  groupName: (id: string) => string,
): string {
  if (!a.include_youth) return "";
  const ids = a.servant_group_ids;
  return ids && ids.length ? `youths of ${ids.map(groupName).join(", ")} at check-in` : "youths at check-in";
}
