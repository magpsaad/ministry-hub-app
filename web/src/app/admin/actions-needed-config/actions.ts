"use server";

import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import { getAttendanceWindowSettings, type AttendanceWindowSettings, type AppSettings } from "@/lib/app-settings";

export type ActionsNeededConfigRow = {
  proximity: "Local" | "Regional" | "Abroad" | "Unknown";
  min_presence_count: number;
  min_absence_weeks: number;
  min_outreach_weeks: number;
};

export async function getActionsNeededConfigAction(): Promise<ActionsNeededConfigRow[]> {
  const supabase = await createClient();
  const { data } = await supabase
    .from("actions_needed_config")
    .select("proximity, min_presence_count, min_absence_weeks, min_outreach_weeks")
    .order("proximity");
  return data ?? [];
}

export async function updateActionsNeededConfigAction(row: ActionsNeededConfigRow) {
  const supabase = await createClient();
  const { error } = await supabase
    .from("actions_needed_config")
    .update({
      min_presence_count: row.min_presence_count,
      min_absence_weeks: row.min_absence_weeks,
      min_outreach_weeks: row.min_outreach_weeks,
    })
    .eq("proximity", row.proximity);
  if (error) return { error: error.message };

  revalidatePath("/admin/actions-needed-config");
  return { error: null };
}

export { getAttendanceWindowSettings };

export type AdminGroupRow = {
  id: string;
  name: string;
  cohort_year: number | null;
  ladder_position: number;
  qr_color: string | null;
};

/** REQUIREMENTS.md §6.9 -- every active (non-archived) group, for the App
 * Settings "Group Names" panel. Includes the pre-entry group (ladder
 * position 0) same as the raw table -- the UI itself decides what's
 * editable/deletable there, the RPCs underneath refuse unsafe operations
 * regardless (rename_group/add_group_tier/delete_group_tier, migration 0030). */
export async function getGroupsForAdminAction(): Promise<AdminGroupRow[]> {
  const supabase = await createClient();
  const { data } = await supabase
    .from("groups")
    .select("id, name, cohort_year, ladder_position, qr_color")
    .eq("is_archived", false)
    .order("ladder_position");
  return data ?? [];
}

export async function renameGroupAction(groupId: string, name: string) {
  const supabase = await createClient();
  const { error } = await supabase.rpc("rename_group", { p_group_id: groupId, p_name: name });
  if (error) return { error: error.message };

  revalidatePath("/admin/actions-needed-config");
  revalidatePath("/", "layout");
  return { error: null };
}

export type AddGroupTierInput = { cohortYear: number | null; name: string; qrColor: string };

/** Extends the active ladder by one tier, inserted just below the current
 * terminal group (which shifts up to make room -- migration 0030). Name is
 * required (migration 0033) -- no auto-naming from group_name_template. */
export async function addGroupTierAction(input: AddGroupTierInput) {
  const supabase = await createClient();
  const { error } = await supabase.rpc("add_group_tier", {
    p_cohort_year: input.cohortYear,
    p_name: input.name,
    p_qr_color: input.qrColor,
  });
  if (error) return { error: error.message };

  revalidatePath("/admin/actions-needed-config");
  revalidatePath("/", "layout");
  return { error: null };
}

/** Archives one mid-ladder group and closes the gap (migration 0030). The
 * RPC itself refuses to touch the pre-entry or terminal group, or a group
 * that still has active members/role grants attached. */
export async function deleteGroupTierAction(groupId: string) {
  const supabase = await createClient();
  const { error } = await supabase.rpc("delete_group_tier", { p_group_id: groupId });
  if (error) return { error: error.message };

  revalidatePath("/admin/actions-needed-config");
  revalidatePath("/", "layout");
  return { error: null };
}

/** The fields the App Settings form edits. The rolling attendance windows
 * and the Actions Needed look-back have their own cards and save actions,
 * so they're deliberately NOT part of this form (saving the branding card
 * must never overwrite a window/look-back change saved from another card). */
export type AppSettingsFormInput = Omit<
  AppSettings,
  "app_version" | "youth_attendance_window_weeks" | "servant_attendance_window_weeks" | "actions_needed_lookback_months"
>;

const HEX_COLOR = /^#[0-9A-Fa-f]{6}$/;

/** REQUIREMENTS.md §2/§6.3/§6.14 -- editable form for the app's identity/
 * vocabulary/schedule fields plus the Current Birthdays date window. RLS
 * restricts writes to Admins regardless of what this screen shows. Only the
 * whitelisted form fields are written -- the client may hold the full
 * settings object, and extra fields must never ride along. */
export async function updateAppSettingsAction(input: AppSettingsFormInput) {
  for (const c of [
    input.theme_color,
    input.theme_color_light,
    input.theme_color_dark,
    input.servants_qr_color,
    input.my_assigned_header_color,
    input.my_assigned_header_color_light,
  ]) {
    if (!HEX_COLOR.test(c)) return { error: `"${c}" isn't a valid colour -- use the #RRGGBB form.` };
  }
  try {
    new Intl.DateTimeFormat("en-US", { timeZone: input.timezone });
  } catch {
    return { error: `"${input.timezone}" isn't a recognized timezone name (e.g. America/Toronto).` };
  }

  const update = {
    app_title_long: input.app_title_long,
    app_title_short: input.app_title_short,
    app_subtitle: input.app_subtitle,
    logo_url: input.logo_url,
    theme_color: input.theme_color,
    theme_color_light: input.theme_color_light,
    theme_color_dark: input.theme_color_dark,
    servants_qr_color: input.servants_qr_color,
    my_assigned_header_color: input.my_assigned_header_color,
    my_assigned_header_color_light: input.my_assigned_header_color_light,
    group_label: input.group_label,
    member_label: input.member_label,
    birthday_window_days_before: input.birthday_window_days_before,
    birthday_window_days_after: input.birthday_window_days_after,
    service_weekday: input.service_weekday,
    same_day_cutoff_time: input.same_day_cutoff_time,
    timezone: input.timezone,
    university_label: input.university_label,
    program_label: input.program_label,
    proximity_enabled: input.proximity_enabled,
    show_proximity_on_attendance: input.show_proximity_on_attendance,
    ladder_position_label: input.ladder_position_label,
  };
  const supabase = await createClient();
  const { error } = await supabase.from("app_settings").update(update).eq("id", true);
  if (error) return { error: error.message };

  // Branding fields are read on nearly every page (header, nav shell), so
  // revalidate broadly rather than just this one admin route.
  revalidatePath("/", "layout");
  return { error: null };
}

/** REQUIREMENTS.md §7.2/§6.13 -- the two independent, admin-configurable
 * rolling-attendance-window settings, folded into this existing threshold-
 * editing screen rather than a new one. */
export async function updateAttendanceWindowSettingsAction(settings: AttendanceWindowSettings) {
  const supabase = await createClient();
  const { error } = await supabase
    .from("app_settings")
    .update({
      youth_attendance_window_weeks: settings.youth_attendance_window_weeks,
      servant_attendance_window_weeks: settings.servant_attendance_window_weeks,
    })
    .eq("id", true);
  if (error) return { error: error.message };

  revalidatePath("/admin/actions-needed-config");
  return { error: null };
}

/** A12 -- how many months back Actions Needed counts visits for its
 * "attended at least N times" rule (was a fixed 12 months). */
export async function updateActionsNeededLookbackAction(months: number) {
  if (!Number.isInteger(months) || months < 1 || months > 120) {
    return { error: "The look-back period must be a whole number of months between 1 and 120." };
  }
  const supabase = await createClient();
  const { error } = await supabase.from("app_settings").update({ actions_needed_lookback_months: months }).eq("id", true);
  if (error) return { error: error.message };

  revalidatePath("/admin/actions-needed-config");
  return { error: null };
}