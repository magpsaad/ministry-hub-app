"use server";

import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";

/** MULTI_TENANT_PLAN.md §3.8 -- the Church Admin console's actions. Each is
 * one call to a database function that itself refuses anyone who isn't a
 * Church Admin, so these add input tidying and friendly messages, not the
 * permission check. */

const CODE = /^[A-Z]{3}$/;
const HEX_COLOR = /^#[0-9A-Fa-f]{6}$/;
const HOST = /^[a-z0-9.-]+(:\d+)?$/;

/** "https://Foo.vercel.app/" -> "foo.vercel.app": the address is stored as
 * a bare host, exactly as the browser sends it. */
function toHost(raw: string): string {
  return raw
    .trim()
    .toLowerCase()
    .replace(/^https?:\/\//, "")
    .replace(/\/.*$/, "");
}

export type CreateMinistryInput = {
  code: string;
  name: string;
  addresses: string[];
  adminEmails: string[];
  preEntryGroupName: string;
  /** GROUP_LADDER_PLAN.md §4.2 -- the hidden hand-over group every ministry gets. */
  terminalGroupName: string;
  copyFrom: string | null;
  settings: {
    app_subtitle: string;
    logo_url: string | null;
    group_label: string;
    member_label: string;
    ladder_position_label: string;
    group_name_template: string;
    /** Added to a level before it's shown (first level 9 -> offset 8). */
    level_number_offset: number;
    terminal_name_pattern: string;
    university_label: string;
    program_label: string;
    service_weekday: number;
    same_day_cutoff_time: string;
    timezone: string;
    proximity_enabled: boolean;
    sub_coordinator_auto_servant: boolean;
    theme_color: string;
    theme_color_light: string;
    theme_color_dark: string;
    my_assigned_header_color: string;
    my_assigned_header_color_light: string;
  };
};

export async function createMinistryAction(input: CreateMinistryInput) {
  const code = input.code.trim().toUpperCase();
  if (!CODE.test(code)) return { error: "The ministry code must be exactly 3 letters." };
  if (!input.name.trim()) return { error: "The ministry name is required." };
  if (!input.preEntryGroupName.trim()) return { error: "A name for the first (pre-entry) group is required." };

  const addresses = input.addresses.map(toHost).filter(Boolean);
  const badHost = addresses.find((h) => !HOST.test(h));
  if (badHost) return { error: `"${badHost}" doesn't look like a web address (e.g. highschool-ministry.vercel.app).` };

  const supabase = await createClient();

  // Optional (owner-requested): with no Admin given, the Church Admin
  // creating the ministry is its first Admin. A new ministry's real Admins
  // usually have no login yet; they're added later from its Access
  // Maintenance once they've signed in at its address.
  let adminEmails = [...new Set(input.adminEmails.map((e) => e.trim().toLowerCase()).filter(Boolean))];
  if (adminEmails.length === 0) {
    const {
      data: { user },
    } = await supabase.auth.getUser();
    if (!user?.email) return { error: "Couldn't read your own email to make you the first Admin. Enter an Admin email." };
    adminEmails = [user.email.toLowerCase()];
  }
  if (adminEmails.length > 2) return { error: "Give at most 2 first Admins." };

  const s = input.settings;
  for (const c of [s.theme_color, s.theme_color_light, s.theme_color_dark, s.my_assigned_header_color, s.my_assigned_header_color_light]) {
    if (!HEX_COLOR.test(c)) return { error: `"${c}" isn't a valid colour -- use the #RRGGBB form.` };
  }
  try {
    new Intl.DateTimeFormat("en-US", { timeZone: s.timezone });
  } catch {
    return { error: `"${s.timezone}" isn't a recognized timezone name (e.g. America/Toronto).` };
  }
  if (!Number.isInteger(s.service_weekday) || s.service_weekday < 1 || s.service_weekday > 7) {
    return { error: "Choose the service day." };
  }
  if (!/^\d{2}:\d{2}(:\d{2})?$/.test(s.same_day_cutoff_time)) return { error: "Choose the same-day cutoff time." };
  for (const [label, v] of [
    ["Group label", s.group_label],
    ["Member label", s.member_label],
    ["Position label", s.ladder_position_label],
    ["School label", s.university_label],
    ["Field of focus label", s.program_label],
    ["Group name template", s.group_name_template],
    ["Hand-over name pattern", s.terminal_name_pattern],
  ] as const) {
    if (!v.trim()) return { error: `${label} can't be blank.` };
  }
  if (!Number.isInteger(s.level_number_offset) || s.level_number_offset < 0 || s.level_number_offset > 50) {
    return { error: "The first level number must be a whole number between 1 and 51." };
  }

  const { error } = await supabase.rpc("create_ministry", {
    p_id: code,
    p_name: input.name.trim(),
    p_addresses: addresses,
    p_admin_emails: adminEmails,
    p_pre_entry_group_name: input.preEntryGroupName.trim(),
    p_settings: { ...s, logo_url: s.logo_url?.trim() || null },
    p_copy_from: input.copyFrom || null,
    p_terminal_group_name: input.terminalGroupName.trim() || null,
  });
  if (error) {
    // "No account for x@y -- ask them to sign in once first": nothing was
    // created (one transaction), so point to the blank-field route.
    if (error.message.startsWith("No account for")) {
      return {
        error: `${error.message.replace(/ -- .*$/, "")}: they haven't signed in to the app yet. Nothing was created. Leave the Admin fields blank to be the first Admin yourself, and add them later from the ministry's Access Maintenance once they've signed in at its address.`,
      };
    }
    return { error: error.message };
  }

  revalidatePath("/console");
  return { error: null, code };
}

export async function updateMinistryAction(code: string, name: string, displayOrder: number) {
  if (!name.trim()) return { error: "The ministry name is required." };
  if (!Number.isInteger(displayOrder)) return { error: "Display order must be a whole number." };

  const supabase = await createClient();
  const { error } = await supabase.rpc("update_ministry", { p_id: code, p_name: name.trim(), p_display_order: displayOrder });
  if (error) return { error: error.message };

  revalidatePath("/console");
  revalidatePath(`/console/ministries/${code}`);
  return { error: null };
}

export async function setMinistryActiveAction(code: string, active: boolean) {
  const supabase = await createClient();
  const { error } = await supabase.rpc("set_ministry_active", { p_id: code, p_active: active });
  if (error) return { error: error.message };

  revalidatePath("/console");
  revalidatePath(`/console/ministries/${code}`);
  return { error: null };
}

export async function addMinistryAddressAction(code: string, rawHost: string) {
  const host = toHost(rawHost);
  if (!host || !HOST.test(host)) return { error: "Enter a web address like highschool-ministry.vercel.app.", host: null };

  const supabase = await createClient();
  const { error } = await supabase.rpc("add_ministry_address", { p_host: host, p_ministry_id: code });
  if (error) {
    return {
      error: error.code === "23505" ? `${host} is already in use.` : error.message,
      host: null,
    };
  }

  revalidatePath("/console");
  revalidatePath(`/console/ministries/${code}`);
  return { error: null, host };
}

export async function removeMinistryAddressAction(code: string, host: string) {
  const supabase = await createClient();
  const { error } = await supabase.rpc("remove_ministry_address", { p_host: host });
  if (error) return { error: error.message };

  revalidatePath("/console");
  revalidatePath(`/console/ministries/${code}`);
  return { error: null };
}
