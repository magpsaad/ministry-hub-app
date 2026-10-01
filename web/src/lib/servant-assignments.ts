import { createClient } from "@/lib/supabase/server";

export type RoleGrant = {
  id: string; // user_roles.id -- every action targets exactly this row
  role: "servant" | "sub_coordinator" | "read_only" | "general_coordinator";
  group_id: string | null;
  group_name: string | null;
  ladder_position: number | null;
  display_order: number | null;
};

export type AssignmentPerson = {
  id: string; // profile id
  full_name: string;
  photo_path: string | null;
  gender: string | null;
  grants: RoleGrant[];
};

/**
 * REQUIREMENTS.md §6.13 -- the Servant Assignments screen's own data
 * source, distinct from getServantDirectory() (which Servant Profiles/
 * Servant Directory/Servants Attendance keep using unchanged -- those are
 * deliberately scoped to just the 'servant' role, per owner: "Servant
 * Profiles is not intended to show access levels"). This one carries every
 * grant a person holds (servant/sub_coordinator/read_only/
 * general_coordinator) as its own row-level object with its own id, since
 * the redesigned screen edits one specific `user_roles` row at a time
 * rather than assuming a person has at most one.
 */
export async function getServantAssignmentsRoster(): Promise<AssignmentPerson[]> {
  const supabase = await createClient();

  const { data: roleRows } = await supabase
    .from("user_roles")
    .select("id, user_id, role, group_id, groups(name, ladder_position, display_order)")
    .in("role", ["servant", "sub_coordinator", "read_only", "general_coordinator"]);

  const { data: profileRows } = await supabase.from("profiles").select("id, full_name, photo_path, gender");
  const profilesById = new Map((profileRows ?? []).map((p) => [p.id, p]));

  const grantsByUser = new Map<string, RoleGrant[]>();
  for (const r of roleRows ?? []) {
    if (!grantsByUser.has(r.user_id)) grantsByUser.set(r.user_id, []);
    const group = r.groups as unknown as { name: string; ladder_position: number; display_order: number } | null;
    grantsByUser.get(r.user_id)!.push({
      id: r.id,
      role: r.role,
      group_id: r.group_id,
      group_name: group?.name ?? null,
      ladder_position: group?.ladder_position ?? null,
      display_order: group?.display_order ?? null,
    });
  }

  const people: AssignmentPerson[] = [];
  for (const [userId, grants] of grantsByUser) {
    const profile = profilesById.get(userId);
    if (!profile) continue;
    people.push({
      id: profile.id,
      full_name: profile.full_name,
      photo_path: profile.photo_path,
      gender: profile.gender,
      grants,
    });
  }

  return people.sort((a, b) => a.full_name.localeCompare(b.full_name));
}
