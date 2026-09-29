"use server";

import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";

/** MULTI_TENANT_PLAN.md P9 -- Version Control is a Church Admin function
 * now: release notes are written once, here in the console, and shown in
 * every ministry. app_releases' write rule enforces Church Admin only
 * (is_church_admin()), so this screen is a convenience, not the gate. */
export async function addReleaseAction(version: string, description: string, releasedOn: string) {
  if (!version.trim()) return { error: "Version number is required.", id: null };

  const supabase = await createClient();
  const { data, error } = await supabase
    .from("app_releases")
    .insert({ version: version.trim(), description: description.trim() || null, released_on: releasedOn })
    .select("id")
    .single();
  if (error) return { error: error.message, id: null };

  revalidatePath("/console/releases");
  return { error: null, id: data.id as string };
}

export async function updateReleaseAction(id: string, version: string, description: string, releasedOn: string) {
  if (!version.trim()) return { error: "Version number is required." };

  const supabase = await createClient();
  const { data, error } = await supabase
    .from("app_releases")
    .update({ version: version.trim(), description: description.trim() || null, released_on: releasedOn })
    .eq("id", id)
    .select("id");
  if (error) return { error: error.message };
  if (!data || data.length === 0) return { error: "You don't have permission to make this change." };

  revalidatePath("/console/releases");
  return { error: null };
}
