"use server";

import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import { photosBucket, isExternalPhotoUrl, ministryFilePath } from "@/lib/storage";
import { getActiveMinistry } from "@/lib/ministry-context";
import { logAudit } from "@/lib/audit";

export type UpdateServantProfileInput = {
  phone: string | null;
  father_of_confession: string | null;
  gender: string | null;
};

/** Full Name and Email are always read-only (REQUIREMENTS.md §6.13) -- never
 * accepted here. Available to any coordinator tier (RLS: profiles_update
 * allows id=self or is_coordinator()). */
export async function updateServantProfileAction(servantId: string, input: UpdateServantProfileInput) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return { error: "Not signed in" };

  const { error } = await supabase.from("profiles").update(input).eq("id", servantId);
  if (error) return { error: error.message };

  await logAudit(user.id, "SERVANT_EDITED", { details: { servantId } });
  revalidatePath("/servant-profiles");
  return { error: null };
}

export async function uploadServantPhotoAction(servantId: string, formData: FormData) {
  const file = formData.get("photo") as File | null;
  if (!file || file.size === 0) return { error: "No file selected" };

  const [supabase, ministryId] = await Promise.all([createClient(), getActiveMinistry()]);
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return { error: "Not signed in" };

  const ext = file.name.split(".").pop() || "jpg";
  const path = ministryFilePath(ministryId, "profiles", `servant-${servantId}-${Date.now()}.${ext}`);

  const { data: existing } = await supabase.from("profiles").select("photo_path").eq("id", servantId).maybeSingle();

  const { error: uploadError } = await supabase.storage.from(photosBucket()).upload(path, file, { contentType: file.type });
  if (uploadError) return { error: uploadError.message };

  const { error: updateError } = await supabase.from("profiles").update({ photo_path: path }).eq("id", servantId);
  if (updateError) return { error: updateError.message };

  if (existing?.photo_path && existing.photo_path !== path && !isExternalPhotoUrl(existing.photo_path)) {
    await supabase.storage.from(photosBucket()).remove([existing.photo_path]);
  }

  await logAudit(user.id, "SERVANT_PHOTO_UPLOADED", { details: { servantId } });
  revalidatePath("/servant-profiles");
  revalidatePath("/servants-directory");
  return { error: null, photoPath: path };
}

export async function removeServantPhotoAction(servantId: string, photoPath: string) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return { error: "Not signed in" };

  void photoPath;
  // Security audit #3 (migration 0082): change the record first (refused
  // for anyone who can't edit this servant), then delete the file it held.
  const { data: before } = await supabase.from("profiles").select("photo_path").eq("id", servantId).maybeSingle();
  const { data: updated, error } = await supabase.from("profiles").update({ photo_path: null }).eq("id", servantId).select("id");
  if (error) return { error: error.message };
  if (!updated || updated.length === 0) return { error: "You don't have permission to make this change." };

  // A Google profile picture link isn't a stored file -- nothing to delete.
  if (before?.photo_path && !isExternalPhotoUrl(before.photo_path)) {
    await supabase.storage.from(photosBucket()).remove([before.photo_path]);
  }

  await logAudit(user.id, "SERVANT_PHOTO_UPLOADED", { details: { servantId, removed: true } });
  revalidatePath("/servant-profiles");
  return { error: null };
}

/** General Coordinator/Admin only -- same RPC-enforced pattern as above. */
export async function removeServantAction(servantId: string) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return { error: "Not signed in" };

  const { error } = await supabase.rpc("remove_servant", { p_user_id: servantId });
  if (error) return { error: error.message };

  await logAudit(user.id, "SERVANT_DELETED", { details: { servantId } });
  revalidatePath("/servant-profiles");
  return { error: null };
}
