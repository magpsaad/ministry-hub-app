"use server";

import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import { ministrySettingsChanged } from "@/lib/ministry-cache-refresh";

export type Verse = { id: string; text: string; reference: string | null; is_active: boolean };

export async function getVersesAction(): Promise<Verse[]> {
  const supabase = await createClient();
  const { data } = await supabase.from("verses").select("id, text, reference, is_active").order("reference");
  return data ?? [];
}

export async function addVerseAction(text: string, reference: string) {
  const supabase = await createClient();
  const { error } = await supabase.from("verses").insert({ text, reference: reference || null });
  if (error) return { error: error.message };

  await ministrySettingsChanged();
  revalidatePath("/admin/verses-maintenance");
  return { error: null };
}

export async function updateVerseAction(id: string, text: string, reference: string) {
  const supabase = await createClient();
  const { error } = await supabase.from("verses").update({ text, reference: reference || null }).eq("id", id);
  if (error) return { error: error.message };

  await ministrySettingsChanged();
  revalidatePath("/admin/verses-maintenance");
  return { error: null };
}

export async function toggleVerseActiveAction(id: string, isActive: boolean) {
  const supabase = await createClient();
  const { error } = await supabase.from("verses").update({ is_active: isActive }).eq("id", id);
  if (error) return { error: error.message };

  await ministrySettingsChanged();
  revalidatePath("/admin/verses-maintenance");
  return { error: null };
}

export async function deleteVerseAction(id: string) {
  const supabase = await createClient();
  const { error } = await supabase.from("verses").delete().eq("id", id);
  if (error) return { error: error.message };

  await ministrySettingsChanged();
  revalidatePath("/admin/verses-maintenance");
  return { error: null };
}
