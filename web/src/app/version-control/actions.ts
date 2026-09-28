"use server";

import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";

export type AppRelease = {
  id: string;
  version: string;
  description: string | null;
  released_on: string;
};

/** Owner-requested: Version Control screen -- newest release first, since
 * that's also the one currently shown as the app-wide "Version X" badge
 * (see getAppSettings()). */
export async function getReleasesAction(): Promise<AppRelease[]> {
  const supabase = await createClient();
  const { data } = await supabase
    .from("app_releases")
    .select("id, version, description, released_on")
    .order("released_on", { ascending: false })
    .order("created_at", { ascending: false });
  return data ?? [];
}

export async function addReleaseAction(version: string, description: string, releasedOn: string) {
  if (!version.trim()) return { error: "Version number is required." };

  const supabase = await createClient();
  const { data, error } = await supabase
    .from("app_releases")
    .insert({ version: version.trim(), description: description.trim() || null, released_on: releasedOn })
    .select("id")
    .single();
  if (error) return { error: error.message, id: null };

  revalidatePath("/version-control");
  return { error: null, id: data.id as string };
}

export async function updateReleaseAction(id: string, version: string, description: string, releasedOn: string) {
  if (!version.trim()) return { error: "Version number is required." };

  const supabase = await createClient();
  const { error } = await supabase
    .from("app_releases")
    .update({ version: version.trim(), description: description.trim() || null, released_on: releasedOn })
    .eq("id", id);
  if (error) return { error: error.message };

  revalidatePath("/version-control");
  return { error: null };
}
