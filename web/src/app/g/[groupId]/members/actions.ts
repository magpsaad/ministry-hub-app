"use server";

import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import { photosBucket, ministryFilePath } from "@/lib/storage";
import { getActiveMinistry } from "@/lib/ministry-context";
import { logAudit } from "@/lib/audit";
import { ALL_COHORTS_GROUP_ID } from "@/lib/allCohorts";

export type UpdateMemberInput = {
  phone: string | null;
  email: string | null;
  university_id: string | null;
  program_of_study: string | null;
  date_of_birth: string | null;
  father_of_confession: string | null;
  home_address: string | null;
  gender: string | null;
  servant_comments: string | null;
  is_visitor: boolean;
};

/** Full Name and Registration Comments are always read-only (REQUIREMENTS.md §6.4) -- never accepted here.
 *
 * Owner-reported (Read-Only role bug): a plain `.update()` with no
 * `.select()` returns `error: null` even when RLS's `using` clause quietly
 * matches zero rows -- Postgres reports that as a successful 0-row update,
 * not a permission error. That let a Read-Only servant's blocked edit look
 * like it saved (no error shown, modal closed) even though nothing actually
 * changed. `.select("id")` + checking the returned rows is the only way to
 * tell "saved" apart from "silently blocked" here. */
export async function updateMemberAction(memberId: string, groupId: string, input: UpdateMemberInput) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  const { data, error } = await supabase.from("members").update(input).eq("id", memberId).select("id");
  if (error) return { error: error.message };
  if (!data || data.length === 0) return { error: "You don't have permission to edit this record." };

  if (user) await logAudit(user.id, "MEMBER_EDITED", { groupId, details: { memberId } });
  revalidatePath(`/g/${groupId}/members`);
  revalidatePath(`/g/${groupId}/dashboard`);
  return { error: null };
}

/** General Coordinator / Admin only -- correction tool for mistaken/test
 * records (RLS enforces this regardless of the UI; REQUIREMENTS.md §3.3.1
 * widened from Admin-only per owner request, see the accompanying migration). */
export async function deleteMemberAction(memberId: string, groupId: string) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  const { data, error } = await supabase.from("members").delete().eq("id", memberId).select("id, group_id");
  if (error) {
    // Owner-reported: the raw FK-violation message ("update or delete on
    // table \"members\" violates foreign key constraint
    // \"attendance_records_member_id_fkey\" on table \"attendance_records\"")
    // isn't something a coordinator should ever have to read. Postgres
    // error code 23503 = foreign_key_violation, regardless of which
    // specific table (attendance_records, outreach_entries, ...) is
    // referencing this member.
    if (error.code === "23503") {
      return { error: "You cannot delete this member — they have historical records (attendance, outreach, etc.) attached." };
    }
    return { error: error.message };
  }
  if (!data || data.length === 0) return { error: "You don't have permission to delete this record." };

  // The youth is gone, so the audit entry takes their group from the deleted row.
  if (user) await logAudit(user.id, "MEMBER_DELETED", { groupId: data[0].group_id ?? groupId, details: { memberId } });
  revalidatePath(`/g/${groupId}/members`);
  revalidatePath(`/g/${groupId}/dashboard`);
  return { error: null };
}

/** Assigning a member to a servant sets `is_new_assignment` so the member
 * surfaces under that servant's Actions Needed list until the servant
 * either outreaches them (auto-cleared by migration 0029's trigger) or
 * dismisses the card (dismissNewAssignmentAction). Unassigning (servantId
 * null) always clears the flag -- there's no servant left to notify. */
export async function assignServantAction(memberId: string, groupId: string, servantId: string | null) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  const { data, error } = await supabase
    .from("members")
    .update({ assigned_servant_id: servantId, is_new_assignment: servantId !== null })
    .eq("id", memberId)
    .select("id");
  if (error) return { error: error.message };
  if (!data || data.length === 0) return { error: "You don't have permission to make this change." };

  if (user) await logAudit(user.id, "SERVANT_ASSIGNED", { groupId, details: { memberId, servantId } });
  revalidatePath(`/g/${groupId}/members`);
  revalidatePath(`/g/${groupId}/dashboard`);
  return { error: null };
}

/** Owner-requested (combined "all cohorts" view): move a member to a
 * different cohort. Admin/General Coordinator only -- enforced both by the
 * UI (only they ever reach the combined view to begin with) and by RLS: the
 * `members_update` policy has no separate `with check`, so Postgres reuses
 * its `using (has_group_access(group_id))` clause against the NEW row too,
 * meaning a Sub-Coordinator could never move someone into a cohort they
 * don't themselves have access to even if they somehow called this.
 *
 * Always clears the assigned servant -- servants are scoped per-cohort, so
 * whoever was assigned in the old cohort is almost certainly not a servant
 * of the new one. The member then shows up as "Unassigned" on the new
 * cohort's dashboard, prompting that cohort's coordinator to reassign. */
export async function moveMemberGroupAction(memberId: string, oldGroupId: string, newGroupId: string) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  const { data, error } = await supabase
    .from("members")
    .update({ group_id: newGroupId, assigned_servant_id: null, is_new_assignment: false })
    .eq("id", memberId)
    .select("id");
  if (error) return { error: error.message };
  if (!data || data.length === 0) return { error: "You don't have permission to make this change." };

  if (user) await logAudit(user.id, "MEMBER_EDITED", { groupId: newGroupId, details: { memberId, action: "moved_cohort", from: oldGroupId, to: newGroupId } });
  revalidatePath(`/g/${oldGroupId}/members`);
  revalidatePath(`/g/${oldGroupId}/dashboard`);
  revalidatePath(`/g/${newGroupId}/members`);
  revalidatePath(`/g/${newGroupId}/dashboard`);
  revalidatePath(`/g/${ALL_COHORTS_GROUP_ID}/members`);
  revalidatePath(`/g/${ALL_COHORTS_GROUP_ID}/dashboard`);
  return { error: null };
}

/** REQUIREMENTS.md §6.3/§7.1 -- manually dismisses a "Newly Assigned" Actions
 * Needed card without requiring an outreach entry. Persistent (a DB column,
 * not sessionStorage) since the card should stay gone across sessions.
 *
 * Owner-reported: this card is captioned "has been assigned to you" and is
 * meant to be that servant's own action item, but the update itself had no
 * check that the caller actually IS that servant -- RLS only scopes by
 * group, not by person, so any coordinator/servant with access to the
 * group could dismiss another servant's card. Checked explicitly here
 * (the Dashboard UI now also hides the button from anyone else, but this
 * is the real enforcement -- a UI hide alone isn't). */
export async function dismissNewAssignmentAction(memberId: string, groupId: string) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return { error: "Not signed in" };

  const { data: member } = await supabase.from("members").select("assigned_servant_id").eq("id", memberId).single();
  if (!member || member.assigned_servant_id !== user.id) {
    return { error: "Only the assigned servant can dismiss this." };
  }

  const { data, error } = await supabase.from("members").update({ is_new_assignment: false }).eq("id", memberId).select("id");
  if (error) return { error: error.message };
  if (!data || data.length === 0) return { error: "You don't have permission to make this change." };

  await logAudit(user.id, "MEMBER_EDITED", { groupId, details: { memberId, action: "new_assignment_dismissed" } });
  revalidatePath(`/g/${groupId}/dashboard`);
  return { error: null };
}

/** Upload/replace a member's photo -- available to any user with access to
 * this member (not admin-restricted, REQUIREMENTS.md §6.4). No cropping yet
 * (the current app's Cropper.js step) -- uploads the picked/captured file
 * as-is; cropping/resizing is a reasonable follow-up polish item.
 *
 * Owner-clarified: a Read-Only servant may ADD a photo when none exists yet,
 * even though they can't replace, remove, or edit anything else. A plain
 * `.update()` would still be blocked by members_update's RLS for that case
 * too (has_group_access excludes read_only entirely), so adding goes
 * through add_member_photo() (migration 0058) -- a narrow security-definer
 * RPC that only ever sets photo_path when it's currently null. Replacing an
 * existing photo still goes through the regular RLS-gated update, which
 * stays out of reach for Read-Only.
 *
 * Each upload gets a unique path (timestamped) rather than overwriting the
 * previous one at a fixed `{memberId}.{ext}` path -- reusing the same path
 * produced the same public URL, which the browser/CDN would keep serving
 * from cache even after the underlying file changed, making "replace" look
 * like a no-op. The old file is removed after the new one is confirmed live. */
export async function uploadMemberPhotoAction(memberId: string, groupId: string, formData: FormData) {
  const file = formData.get("photo") as File | null;
  if (!file || file.size === 0) return { error: "No file selected" };

  const [supabase, ministryId] = await Promise.all([createClient(), getActiveMinistry()]);
  const {
    data: { user },
  } = await supabase.auth.getUser();
  const ext = file.name.split(".").pop() || "jpg";
  const path = ministryFilePath(ministryId, "members", `${memberId}-${Date.now()}.${ext}`);

  const { data: existing } = await supabase.from("members").select("photo_path").eq("id", memberId).maybeSingle();

  const { error: uploadError } = await supabase.storage
    .from(photosBucket())
    .upload(path, file, { contentType: file.type });
  if (uploadError) return { error: uploadError.message };

  let updateOk: boolean;
  if (existing?.photo_path) {
    const { data: updated, error: updateError } = await supabase.from("members").update({ photo_path: path }).eq("id", memberId).select("id");
    if (updateError) {
      await supabase.storage.from(photosBucket()).remove([path]);
      return { error: updateError.message };
    }
    updateOk = !!updated && updated.length > 0;
  } else {
    const { data: added, error: addError } = await supabase.rpc("add_member_photo", { p_member_id: memberId, p_photo_path: path });
    if (addError) {
      await supabase.storage.from(photosBucket()).remove([path]);
      return { error: addError.message };
    }
    updateOk = added === true;
  }

  if (!updateOk) {
    // The file itself already made it into storage (storage policies are
    // separate from this table's RLS) -- clean up the now-orphaned upload
    // rather than leaving it unlinked.
    await supabase.storage.from(photosBucket()).remove([path]);
    return { error: "You don't have permission to make this change." };
  }

  if (existing?.photo_path && existing.photo_path !== path) {
    await supabase.storage.from(photosBucket()).remove([existing.photo_path]);
  }

  if (user) await logAudit(user.id, "MEMBER_PHOTO_UPLOADED", { groupId, details: { memberId } });
  revalidatePath(`/g/${groupId}/members`);
  revalidatePath(`/g/${groupId}/dashboard`);
  return { error: null, photoPath: path };
}

export async function removeMemberPhotoAction(memberId: string, groupId: string, photoPath: string) {
  const supabase = await createClient();
  const { error: removeError } = await supabase.storage.from(photosBucket()).remove([photoPath]);
  if (removeError) return { error: removeError.message };

  const { data, error } = await supabase.from("members").update({ photo_path: null }).eq("id", memberId).select("id");
  if (error) return { error: error.message };
  if (!data || data.length === 0) return { error: "You don't have permission to make this change." };

  revalidatePath(`/g/${groupId}/members`);
  revalidatePath(`/g/${groupId}/dashboard`);
  return { error: null };
}
