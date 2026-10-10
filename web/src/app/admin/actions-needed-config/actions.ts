"use server";

import { checkUpload } from "@/lib/upload-check";
import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import { getActiveMinistry } from "@/lib/ministry-context";
import { brandingBucket, brandingPublicUrl, ministryFilePath } from "@/lib/storage";
import { getAttendanceWindowSettings, type AttendanceWindowSettings, type AppSettings } from "@/lib/app-settings";
import { LOCK_MINUTE_CHOICES } from "@/lib/screen-lock";
import { getRoleLabels, roleWords } from "@/lib/role-labels-server";
import { relabelRoleWords } from "@/lib/role-labels";

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
  if (error) return { error: await roleWords(error.message) };

  revalidatePath("/admin/actions-needed-config");
  return { error: null };
}

export { getAttendanceWindowSettings };

export type AdminGroupRow = {
  id: string;
  name: string;
  cohort_year: number | null;
  ladder_position: number;
  display_order: number;
  kind: "pre_entry" | "regular" | "terminal";
  qr_color: string | null;
  /** D5 -- only the pre-entry and hand-over groups can be switched off. */
  qr_active: boolean;
  /** Re-applied at every Group Transition; null = the name never changes. */
  name_pattern: string | null;
  /** D13 -- set when this group uses another group's check-in code. */
  check_in_code_group_id: string | null;
  /** 0073 -- fill {gender} and {patron_saint} in name patterns. */
  gender_label: string | null;
  patron_saint: string | null;
  active_count: number;
};

/** GROUP_LADDER_PLAN.md §4.5 -- every active group, in display order, for
 * the App Settings "Group Names & QR Code Colors" panel, with its active
 * youth count. The functions underneath (migration 0069) refuse anything
 * unsafe regardless of what the screen offers. */
export async function getGroupsForAdminAction(): Promise<AdminGroupRow[]> {
  const supabase = await createClient();
  const [{ data }, { data: members }] = await Promise.all([
    supabase
      .from("groups")
      .select("id, name, cohort_year, ladder_position, display_order, kind, qr_color, qr_active, name_pattern, check_in_code_group_id, gender_label, patron_saint")
      .eq("is_archived", false)
      .order("display_order"),
    supabase.from("members").select("group_id").eq("status", "active"),
  ]);
  const counts = new Map<string, number>();
  for (const m of members ?? []) counts.set(m.group_id, (counts.get(m.group_id) ?? 0) + 1);
  return (data ?? []).map((g) => ({ ...(g as Omit<AdminGroupRow, "active_count">), active_count: counts.get(g.id) ?? 0 }));
}

function groupsChanged() {
  revalidatePath("/admin/actions-needed-config");
  revalidatePath("/", "layout");
}

/** D4 -- swap a regular group with its neighbour in the list order. */
export async function moveGroupAction(groupId: string, direction: "up" | "down") {
  const supabase = await createClient();
  const { error } = await supabase.rpc("move_group", { p_group_id: groupId, p_direction: direction });
  if (error) return { error: await roleWords(error.message) };
  groupsChanged();
  return { error: null };
}

/** Put a regular group at another level (levels stay 1..N without gaps). */
export async function setGroupLevelAction(groupId: string, level: number) {
  const supabase = await createClient();
  const { error } = await supabase.rpc("set_group_level", { p_group_id: groupId, p_level: level });
  if (error) return { error: await roleWords(error.message) };
  groupsChanged();
  return { error: null };
}

/** A group's yearly name pattern; empty = keep its name as it is. */
export async function setGroupNamePatternAction(groupId: string, pattern: string) {
  const supabase = await createClient();
  const { error } = await supabase.rpc("set_group_name_pattern", { p_group_id: groupId, p_pattern: pattern });
  if (error) return { error: await roleWords(error.message) };
  groupsChanged();
  return { error: null };
}

/** 0073 -- a group's gender and patron saint, for {gender} and
 * {patron_saint} in its yearly name pattern. Admins only (checked by the RPC). */
export async function setGroupGenderSaintAction(groupId: string, gender: string, patronSaint: string) {
  const supabase = await createClient();
  const { error } = await supabase.rpc("set_group_gender_saint", {
    p_group_id: groupId,
    p_gender: gender,
    p_patron_saint: patronSaint,
  });
  if (error) return { error: await roleWords(error.message) };
  groupsChanged();
  return { error: null };
}

/** D5 -- the "QR code active" switch of the pre-entry or hand-over group. */
export async function setGroupQrActiveAction(groupId: string, active: boolean) {
  const supabase = await createClient();
  const { error } = await supabase.rpc("set_group_qr_active", { p_group_id: groupId, p_active: active });
  if (error) return { error: await roleWords(error.message) };
  groupsChanged();
  return { error: null };
}

/** D13 -- use another group's check-in code (null = back to its own). */
export async function setGroupCheckInCodeAction(groupId: string, codeGroupId: string | null) {
  const supabase = await createClient();
  const { error } = await supabase.rpc("set_group_check_in_code", { p_group_id: groupId, p_code_group_id: codeGroupId });
  if (error) return { error: await roleWords(error.message) };
  groupsChanged();
  return { error: null };
}

const PATTERN_PLACEHOLDER = /\{(level|cohort_year|position_label)\}/;

/** Q3/D9 -- the default yearly name pattern new groups start from (empty =
 * none: names are typed by hand) and the hand-over group's pattern. Admins
 * only (app_settings_write); a refused update touches 0 rows. */
export async function updateNamePatternsAction(defaultPattern: string, terminalPattern: string) {
  const def = defaultPattern.trim();
  const term = terminalPattern.trim();
  if (def && !PATTERN_PLACEHOLDER.test(def)) return { error: "The default name pattern needs {level} or {cohort_year}." };
  if (!term) return { error: "The hand-over name pattern can't be empty." };
  const [supabase, ministryId] = await Promise.all([createClient(), getActiveMinistry()]);
  const { data, error } = await supabase
    .from("app_settings")
    .update({ group_name_template: def || null, terminal_name_pattern: term })
    .eq("ministry_id", ministryId)
    .select("ministry_id");
  if (error) return { error: await roleWords(error.message) };
  if (!data || data.length === 0) return { error: "You don't have permission to change the name patterns." };
  groupsChanged();
  return { error: null };
}

export async function renameGroupAction(groupId: string, name: string) {
  const supabase = await createClient();
  const { error } = await supabase.rpc("rename_group", { p_group_id: groupId, p_name: name });
  if (error) return { error: await roleWords(error.message) };

  revalidatePath("/admin/actions-needed-config");
  revalidatePath("/", "layout");
  return { error: null };
}

/** A group's QR code colour (groups.qr_color), edited from the Group Names
 * panel; the QR Codes page and print view read it live. Admins only (the
 * groups_admin_write security rule) -- a refused update touches 0 rows
 * without an error, so the row count is checked. */
export async function updateGroupQrColorAction(groupId: string, color: string) {
  if (!HEX_COLOR.test(color)) return { error: `"${color}" isn't a valid colour -- use the #RRGGBB form.` };
  const supabase = await createClient();
  const { data, error } = await supabase.from("groups").update({ qr_color: color }).eq("id", groupId).select("id");
  if (error) return { error: await roleWords(error.message) };
  if (!data || data.length === 0) return { error: "You don't have permission to change this group's QR colour." };

  revalidatePath("/admin/actions-needed-config");
  revalidatePath("/", "layout");
  return { error: null };
}

/** The Servants QR code colour (app_settings.servants_qr_color), edited
 * from the Group Names panel next to the groups' own QR colours. Admins
 * only (app_settings_write); a refused update touches 0 rows, so the row
 * count is checked. */
export async function updateServantsQrColorAction(color: string) {
  if (!HEX_COLOR.test(color)) return { error: `"${color}" isn't a valid colour -- use the #RRGGBB form.` };
  const [supabase, ministryId] = await Promise.all([createClient(), getActiveMinistry()]);
  const { data, error } = await supabase
    .from("app_settings")
    .update({ servants_qr_color: color })
    .eq("ministry_id", ministryId)
    .select("ministry_id");
  if (error) return { error: await roleWords(error.message) };
  if (!data || data.length === 0) {
    const L = await getRoleLabels();
    return { error: `You don't have permission to change the ${L.servants} QR colour.` };
  }

  revalidatePath("/admin/actions-needed-config");
  revalidatePath("/", "layout");
  return { error: null };
}

export type AddGroupInput = {
  name: string;
  /** null = a new top level (just below the hand-over group). */
  level: number | null;
  cohortYear: number | null;
  /** null = picked automatically, distinct from the ministry's others (A8). */
  qrColor: string | null;
  namePattern: string;
  /** 0073 -- optional, for {gender} and {patron_saint}. */
  gender: string;
  patronSaint: string;
};

/** D4 -- a new regular group, always listed last before the hand-over
 * group, at a new top level or sharing an existing one (several classes per
 * grade). add_group() (migration 0069) checks the name is free. */
export async function addGroupAction(input: AddGroupInput) {
  if (input.qrColor && !HEX_COLOR.test(input.qrColor)) return { error: `"${input.qrColor}" isn't a valid colour.` };
  const supabase = await createClient();
  const { data: newId, error } = await supabase.rpc("add_group", {
    p_name: input.name,
    p_level: input.level,
    p_cohort_year: input.cohortYear,
    p_qr_color: input.qrColor,
    p_name_pattern: input.namePattern,
  });
  if (error) return { error: await roleWords(error.message) };
  if (newId && (input.gender.trim() || input.patronSaint.trim())) {
    const res = await supabase.rpc("set_group_gender_saint", {
      p_group_id: newId as string,
      p_gender: input.gender,
      p_patron_saint: input.patronSaint,
    });
    if (res.error) {
      groupsChanged();
      return { error: `The group was added, but its gender and patron saint weren't saved: ${await roleWords(res.error.message)}` };
    }
  }
  groupsChanged();
  return { error: null };
}

/** Archives a regular group with no youths or role grants left and closes
 * any gap in the levels. The RPC refuses the pre-entry and hand-over
 * groups, and a group whose check-in code others share. */
export async function deleteGroupTierAction(groupId: string) {
  const supabase = await createClient();
  const { error } = await supabase.rpc("delete_group_tier", { p_group_id: groupId });
  if (error) return { error: await roleWords(error.message) };

  revalidatePath("/admin/actions-needed-config");
  revalidatePath("/", "layout");
  return { error: null };
}

/** The fields the App Settings form edits. The rolling attendance windows,
 * the Actions Needed look-back and the Servants QR colour (Group Names panel)
 * have their own save actions, so they're deliberately NOT part of this form
 * (saving one card must never overwrite a value saved from another). */
export type AppSettingsFormInput = Omit<
  AppSettings,
  | "app_version"
  | "youth_attendance_window_weeks"
  | "servant_attendance_window_weeks"
  | "actions_needed_lookback_months"
  | "servants_qr_color"
  | "group_name_template"
  | "terminal_name_pattern"
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
    input.my_assigned_header_color,
    input.my_assigned_header_color_light,
  ]) {
    if (!HEX_COLOR.test(c)) return { error: `"${c}" isn't a valid colour -- use the #RRGGBB form.` };
  }
  if (!Number.isInteger(input.level_number_offset) || input.level_number_offset < 0 || input.level_number_offset > 50) {
    return { error: "The first level number must be a whole number between 1 and 51." };
  }
  const TIME = /^\d{2}:\d{2}(:\d{2})?$/;
  if (!TIME.test(input.checkin_opens_at) || !TIME.test(input.checkin_closes_at)) {
    return { error: "Choose both check-in times." };
  }
  if (input.checkin_opens_at.slice(0, 5) >= input.checkin_closes_at.slice(0, 5)) {
    return { error: "Check-in must open before it closes." };
  }
  // Migration 0097: the two role words -- letters, spaces, hyphens and
  // apostrophes, 2-30 characters, shown with an "s" added for plurals.
  const ROLE_WORD = /^[\p{L}][\p{L} '\-]{0,28}[\p{L}]$/u;
  for (const [name, value] of [
    ["Servant", input.servant_label],
    ["Coordinator", input.sub_coordinator_label],
  ] as const) {
    if (!ROLE_WORD.test(value.trim())) {
      return { error: `The ${name} label must be 2-30 letters (spaces, hyphens and apostrophes allowed).` };
    }
  }
  if (!["group", "grade", "grade_gender"].includes(input.coordinator_scope)) {
    return { error: "Choose what Coordinators are assigned to." };
  }
  if (!["gc", "gc_admin", "none"].includes(input.message_oversight)) {
    return { error: "Choose who can read every conversation in Messages." };
  }
  if (input.idle_lock_minutes !== null && !(LOCK_MINUTE_CHOICES as readonly number[]).includes(input.idle_lock_minutes)) {
    return { error: "Choose how many minutes before the screen locks, or Off." };
  }
  if (input.using_app_since !== null && !/^\d{4}-\d{2}-\d{2}$/.test(input.using_app_since)) {
    return { error: "Choose the date the ministry started using the app." };
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
    my_assigned_header_color: input.my_assigned_header_color,
    my_assigned_header_color_light: input.my_assigned_header_color_light,
    group_label: input.group_label,
    member_label: input.member_label,
    servant_label: input.servant_label.trim().replace(/\s+/g, " "),
    sub_coordinator_label: input.sub_coordinator_label.trim().replace(/\s+/g, " "),
    birthday_window_days_before: input.birthday_window_days_before,
    birthday_window_days_after: input.birthday_window_days_after,
    service_weekday: input.service_weekday,
    same_day_cutoff_time: input.same_day_cutoff_time,
    checkin_opens_at: input.checkin_opens_at,
    // "23:59" from the form means through the end of that minute.
    checkin_closes_at: input.checkin_closes_at.length === 5 && input.checkin_closes_at === "23:59" ? "23:59:59" : input.checkin_closes_at,
    timezone: input.timezone,
    university_label: input.university_label,
    program_label: input.program_label,
    proximity_enabled: input.proximity_enabled,
    show_proximity_on_attendance: input.show_proximity_on_attendance,
    ladder_position_label: input.ladder_position_label,
    level_number_offset: input.level_number_offset,
    sub_coordinator_auto_servant: input.sub_coordinator_auto_servant,
    show_parent_contacts: input.show_parent_contacts,
    idle_lock_minutes: input.idle_lock_minutes,
    message_oversight: input.message_oversight,
    coordinator_scope: input.coordinator_scope,
    using_app_since: input.using_app_since,
  };
  // Saved by this ministry's code (the settings table has one row per
  // ministry now, MULTI_TENANT_PLAN.md §2.5 #1); the security rule would
  // refuse any other ministry's row anyway.
  const [supabase, ministryId] = await Promise.all([createClient(), getActiveMinistry()]);
  const { error } = await supabase.from("app_settings").update(update).eq("ministry_id", ministryId);
  if (error) return { error: await roleWords(error.message) };

  // Branding fields are read on nearly every page (header, nav shell), so
  // revalidate broadly rather than just this one admin route.
  revalidatePath("/", "layout");
  return { error: null };
}

/** Upload a new logo for THIS ministry and make it the logo straight away
 * (only logo_url is written, so unsaved edits elsewhere on the form are
 * untouched). The file goes into the ministry's own branding folder
 * ("TST/branding/logo-….png", MULTI_TENANT_PLAN.md §7); the storage rules
 * let only this ministry's Admins (or the Church Admin) write there. Each
 * upload gets a new file name so browsers can't keep showing a cached old
 * logo. The previous logo file is left in place (the branding bucket keeps
 * no delete rule), which also means a mistaken upload can be undone by
 * pasting the old address back into Logo URL. */
export async function uploadLogoAction(formData: FormData) {
  const file = formData.get("logo") as File | null;
  if (!file || file.size === 0) return { error: "Choose an image first.", logoUrl: null };
  // Security audit #6: also checks the file really is that image type.
  const checked = await checkUpload(file, "logo");
  if ("error" in checked) return { error: checked.error, logoUrl: null };
  const ext = checked.ext;

  const [supabase, ministryId] = await Promise.all([createClient(), getActiveMinistry()]);
  const path = ministryFilePath(ministryId, "branding", `logo-${Date.now()}.${ext}`);
  const { error: uploadError } = await supabase.storage
    .from(brandingBucket())
    .upload(path, file, { contentType: checked.contentType });
  if (uploadError) {
    return {
      error: /row-level security|unauthorized|403/i.test(uploadError.message)
        ? "Only System Admins can change the logo."
        : uploadError.message,
      logoUrl: null,
    };
  }

  const logoUrl = brandingPublicUrl(path);
  const { data, error } = await supabase
    .from("app_settings")
    .update({ logo_url: logoUrl })
    .eq("ministry_id", ministryId)
    .select("ministry_id");
  if (error) return { error: await roleWords(error.message), logoUrl: null };
  if (!data || data.length === 0) return { error: "Only System Admins can change the logo.", logoUrl: null };

  // The logo shows in every page header, the sign-in page and QR codes.
  revalidatePath("/", "layout");
  return { error: null, logoUrl };
}

/** REQUIREMENTS.md §7.2/§6.13 -- the two independent, admin-configurable
 * rolling-attendance-window settings, folded into this existing threshold-
 * editing screen rather than a new one. */
export async function updateAttendanceWindowSettingsAction(settings: AttendanceWindowSettings) {
  const [supabase, ministryId] = await Promise.all([createClient(), getActiveMinistry()]);
  const { error } = await supabase
    .from("app_settings")
    .update({
      youth_attendance_window_weeks: settings.youth_attendance_window_weeks,
      servant_attendance_window_weeks: settings.servant_attendance_window_weeks,
    })
    .eq("ministry_id", ministryId);
  if (error) return { error: await roleWords(error.message) };

  revalidatePath("/admin/actions-needed-config");
  return { error: null };
}

/** A12 -- how many months back Actions Needed counts visits for its
 * "attended at least N times" rule (was a fixed 12 months). */
export async function updateActionsNeededLookbackAction(months: number) {
  if (!Number.isInteger(months) || months < 1 || months > 120) {
    return { error: "The look-back period must be a whole number of months between 1 and 120." };
  }
  const [supabase, ministryId] = await Promise.all([createClient(), getActiveMinistry()]);
  const { error } = await supabase
    .from("app_settings")
    .update({ actions_needed_lookback_months: months })
    .eq("ministry_id", ministryId);
  if (error) return { error: await roleWords(error.message) };

  revalidatePath("/admin/actions-needed-config");
  return { error: null };
}

/** Notification Defaults (owner-requested 6 Oct 2026, migration 0096):
 * the kinds of notification people can choose, with this ministry's
 * default for each. */
export async function getNotificationDefaultsAction() {
  const [supabase, L] = await Promise.all([createClient(), getRoleLabels()]);
  const { data } = await supabase.rpc("ministry_notification_defaults");
  // Stored with the standard words (migration 0097).
  return ((data ?? []) as {
    event: string;
    label: string;
    description: string;
    roles: string[];
    default_on: boolean;
    church_default: boolean;
  }[]).map((r) => ({ ...r, label: relabelRoleWords(r.label, L), description: relabelRoleWords(r.description, L) })) as {
    event: string;
    label: string;
    description: string;
    roles: string[];
    default_on: boolean;
    church_default: boolean;
  }[];
}

/** Whether one kind starts on or off for this ministry's people -- anyone
 * who chose for themselves in My Settings keeps their choice. */
export async function setMinistryNotificationDefaultAction(event: string, on: boolean): Promise<{ error: string | null }> {
  const supabase = await createClient();
  const { error } = await supabase.rpc("set_ministry_notification_default", { p_event: event, p_on: on });
  if (error) return { error: "Couldn't save that. Please try again." };
  revalidatePath("/admin/actions-needed-config");
  return { error: null };
}
