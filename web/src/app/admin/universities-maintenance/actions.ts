"use server";

import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import { ministrySettingsChanged } from "@/lib/ministry-cache-refresh";

export async function addUniversityAction(name: string, proximity: string) {
  const supabase = await createClient();
  const { error } = await supabase.from("universities").insert({ name, proximity });
  if (error) return { error: error.message };

  await ministrySettingsChanged();
  revalidatePath("/admin/universities-maintenance");
  return { error: null };
}

export async function updateUniversityAction(id: string, name: string, proximity: string) {
  const supabase = await createClient();
  const { error } = await supabase.from("universities").update({ name, proximity }).eq("id", id);
  if (error) return { error: error.message };

  await ministrySettingsChanged();
  revalidatePath("/admin/universities-maintenance");
  return { error: null };
}

export async function deleteUniversityAction(id: string) {
  const supabase = await createClient();
  const { error } = await supabase.from("universities").delete().eq("id", id);
  if (error) return { error: error.message };

  await ministrySettingsChanged();
  revalidatePath("/admin/universities-maintenance");
  return { error: null };
}
