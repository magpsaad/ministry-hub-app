"use server";

import { cookies } from "next/headers";
import { createClient } from "@/lib/supabase/server";
import type { CheckInPerson } from "@/lib/checkin";
import {
  SERVANT_CHECKIN_COOKIE,
  MEMBER_CHECKIN_COOKIE,
  CHECKIN_REMEMBER_COOKIE_MAX_AGE,
  serializeRememberedCheckinPerson,
} from "@/lib/checkin-remember-cookie";

/** Shared by mark*AttendanceAction for both the member and servant flows --
 * writes `id`/`kind` into the given cookie and returns whatever it
 * previously held, so a following undo can restore it exactly. */
async function writeRememberCookie(cookieName: string, id: string, kind: "member" | "servant" | "pending") {
  const cookieStore = await cookies();
  const previousRemembered = cookieStore.get(cookieName)?.value ?? null;
  cookieStore.set(cookieName, serializeRememberedCheckinPerson({ id, kind }), {
    maxAge: CHECKIN_REMEMBER_COOKIE_MAX_AGE,
    path: "/",
    sameSite: "lax",
  });
  return previousRemembered;
}

/** Shared by undo*AttendanceAction -- reverts a cookie to exactly what
 * writeRememberCookie captured before the mis-tap being undone. */
async function restoreRememberCookie(cookieName: string, previousRemembered: string | null) {
  const cookieStore = await cookies();
  if (previousRemembered) {
    cookieStore.set(cookieName, previousRemembered, {
      maxAge: CHECKIN_REMEMBER_COOKIE_MAX_AGE,
      path: "/",
      sameSite: "lax",
    });
  } else {
    cookieStore.delete(cookieName);
  }
}

/** Normalizes any phone input to `1 (416) 930-1659` -- REQUIREMENTS.md §6.11
 * item 6. Leaves anything that isn't a recognizable 10/11-digit North
 * American number untouched rather than guessing. */
function formatPhone(raw: string): string {
  const digits = raw.replace(/\D/g, "");
  const ten = digits.length === 11 && digits.startsWith("1") ? digits.slice(1) : digits;
  if (ten.length !== 10) return raw.trim();
  return `1 (${ten.slice(0, 3)}) ${ten.slice(3, 6)}-${ten.slice(6)}`;
}

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

/** Server-side backstop for the client-side checks in the intake forms --
 * mandatory Name/Phone/Email/Gender, Name >=2 words, valid phone digit
 * count, valid email shape. Everything else stays free-form. */
function validateIntake(input: { full_name: string; phone: string | null; email: string | null; gender: string | null }): string | null {
  if (!input.full_name.trim() || input.full_name.trim().split(/\s+/).length < 2) {
    return "Please enter your first and last name.";
  }
  const digits = (input.phone ?? "").replace(/\D/g, "");
  if (digits.length < 10 || digits.length > 11) {
    return "Please enter a valid phone number.";
  }
  if (!input.email || !EMAIL_RE.test(input.email.trim())) {
    return "Please enter a valid email address.";
  }
  if (!input.gender) {
    return "Please select a gender.";
  }
  return null;
}

export type MissingMemberFields = {
  phone: boolean;
  email: boolean;
  university: boolean;
  program: boolean;
  dob: boolean;
  fatherOfConfession: boolean;
};

/** `newlyCreated` distinguishes "this tap actually created today's
 * attendance record" from "today's record already existed" (someone else
 * already checked this person in, or a coordinator marked it manually) --
 * the client only offers "Not you? Undo" when it's true, since undoing an
 * already-existing record would remove something this tap didn't create.
 *
 * `missingFields` (owner-requested) tells the client which of Phone/Email/
 * University/Program/DOB/Father of Confession are currently blank on this
 * member's record -- computed server-side so the client never has to
 * receive (and could never accidentally display) the record's real values
 * to figure this out itself.
 *
 * `remember` is the owner-requested "Remember me on this device" checkbox
 * (default checked) -- see markServantAttendanceAction for the full
 * rationale, identical here for the member/youth flow. */
export async function markMemberAttendanceAction(token: string, memberId: string, remember: boolean) {
  const supabase = await createClient();
  const { data, error } = await supabase.rpc("checkin_mark_attendance", { p_token: token, p_member_id: memberId }).single();
  const row = data as {
    attendance_recorded: boolean;
    newly_created: boolean;
    missing_phone: boolean;
    missing_email: boolean;
    missing_university: boolean;
    missing_program: boolean;
    missing_dob: boolean;
    missing_father_of_confession: boolean;
  } | null;
  const missingFields: MissingMemberFields = {
    phone: row?.missing_phone ?? false,
    email: row?.missing_email ?? false,
    university: row?.missing_university ?? false,
    program: row?.missing_program ?? false,
    dob: row?.missing_dob ?? false,
    fatherOfConfession: row?.missing_father_of_confession ?? false,
  };

  let rememberedCookieWritten = false;
  let previousRemembered: string | null = null;
  if (!error && remember) {
    previousRemembered = await writeRememberCookie(MEMBER_CHECKIN_COOKIE, memberId, "member");
    rememberedCookieWritten = true;
  }

  return {
    error: error?.message ?? null,
    attendanceRecorded: row?.attendance_recorded ?? false,
    newlyCreated: row?.newly_created ?? false,
    missingFields,
    rememberedCookieWritten,
    previousRemembered,
  };
}

export type MissingFieldsInput = {
  phone: string | null;
  email: string | null;
  university_id: string | null;
  program_of_study: string | null;
  date_of_birth: string | null;
  father_of_confession: string | null;
};

/** Owner-requested: lets a youth fill in whichever of their own record's
 * blank fields are shown to them, right from the check-in success screen.
 * Only ever sends what they typed -- validation mirrors validateIntake's
 * per-field checks, but every field here is optional (skip validating
 * anything left blank), since they may only want to fill in some of what's
 * shown. The RPC itself is the real backstop: it only ever writes into a
 * field that's still genuinely blank, regardless of what's sent. */
export async function fillMissingMemberFieldsAction(token: string, memberId: string, input: MissingFieldsInput) {
  const phoneDigits = (input.phone ?? "").replace(/\D/g, "");
  if (input.phone && (phoneDigits.length < 10 || phoneDigits.length > 11)) {
    return { error: "Please enter a valid phone number." };
  }
  if (input.email && !EMAIL_RE.test(input.email.trim())) {
    return { error: "Please enter a valid email address." };
  }

  const supabase = await createClient();
  const { error } = await supabase.rpc("checkin_fill_missing_member_fields", {
    p_token: token,
    p_member_id: memberId,
    p_phone: input.phone ? formatPhone(input.phone) : null,
    p_email: input.email?.trim() || null,
    p_university_id: input.university_id || null,
    p_program_of_study: input.program_of_study?.trim() || null,
    p_date_of_birth: input.date_of_birth || null,
    p_father_of_confession: input.father_of_confession?.trim() || null,
  });
  return { error: error?.message ?? null };
}

/** Mis-tap recovery for the self-check-in list (owner-reported: a wrong tap
 * had no way to be undone). Only removes a record checkin_mark_attendance
 * itself created within the last couple minutes (see migration 0046) --
 * never something pre-existing. `restoreCookie` reverts the "Remember me"
 * cookie write from that same tap, same as undoServantAttendanceAction. */
export async function undoMemberAttendanceAction(
  token: string,
  memberId: string,
  restoreCookie?: { rememberedCookieWritten: boolean; previousRemembered: string | null },
) {
  const supabase = await createClient();
  const { error } = await supabase.rpc("checkin_undo_attendance", { p_token: token, p_member_id: memberId });

  if (!error && restoreCookie?.rememberedCookieWritten) {
    await restoreRememberCookie(MEMBER_CHECKIN_COOKIE, restoreCookie.previousRemembered);
  }

  return { error: error?.message ?? null };
}

export type NewMemberInput = {
  full_name: string;
  phone: string | null;
  email: string | null;
  university_id: string | null;
  program_of_study: string | null;
  date_of_birth: string | null;
  father_of_confession: string | null;
  home_address: string | null;
  gender: string | null;
  comments: string | null;
};

/** Migration 0074 -- the check-in page's name search: nothing until 3
 * letters are typed, then at most 10 matches as short names ("Mina H.").
 * `closed` = outside check-in hours (the page then shows when it opens). */
export async function searchCheckInPeopleAction(
  token: string,
  query: string,
  isServant: boolean,
): Promise<{ people: CheckInPerson[]; closed: boolean }> {
  const supabase = await createClient();
  if (isServant) {
    const { data, error } = await supabase.rpc("checkin_search_servants", { p_token: token, p_query: query });
    if (error) return { people: [], closed: error.message.includes("closed") };
    return {
      people: ((data ?? []) as { id: string; display_name: string; kind: "servant" | "pending" }[]).map((r) => ({
        id: r.id,
        full_name: r.display_name,
        kind: r.kind,
      })),
      closed: false,
    };
  }
  const { data, error } = await supabase.rpc("checkin_search_members", { p_token: token, p_query: query });
  if (error) return { people: [], closed: error.message.includes("closed") };
  return {
    people: ((data ?? []) as { member_id: string; display_name: string }[]).map((r) => ({
      id: r.member_id,
      full_name: r.display_name,
      kind: "member" as const,
    })),
    closed: false,
  };
}

/** Owner-reported: a youth's real, already-registered record (possibly in
 * another cohort) went undetected when she used "New Youth Registration"
 * instead of finding her name -- so before creating anything, check for an
 * existing record. Migration 0074 (owner-requested hardening): the database
 * re-finds the record itself and only when at least two of name, phone and
 * email match; it answers only "found" and "same class", never which
 * details matched, the record's id or its class. */
export type DuplicateMatch = { sameGroup: boolean };

export async function checkPossibleDuplicateMemberAction(token: string, input: NewMemberInput): Promise<DuplicateMatch | null> {
  const supabase = await createClient();
  const { data, error } = await supabase
    .rpc("checkin_find_possible_duplicate_member", {
      p_token: token,
      p_full_name: input.full_name.trim(),
      p_phone: formatPhone(input.phone ?? ""),
      p_email: input.email?.trim() ?? "",
    })
    .maybeSingle();
  if (error || !data) return null;
  const row = data as { match_found: boolean; same_group: boolean };
  return row.match_found ? { sameGroup: row.same_group } : null;
}

/** The "yes, it's me" path (migration 0074): checks her in against her
 * existing record. Whatever she typed only fills that record's BLANK
 * fields; anything that differs, and a request to move to the class she
 * scanned, becomes a dated note on the record for the servants to review
 * -- the public page can never overwrite or move a record. */
export async function resolveDuplicateMemberAction(token: string, input: NewMemberInput, moveRequested: boolean) {
  const supabase = await createClient();
  const { data, error } = await supabase
    .rpc("checkin_resolve_duplicate_member", {
      p_token: token,
      p_full_name: input.full_name.trim(),
      p_phone: input.phone ? formatPhone(input.phone) : null,
      p_email: input.email?.trim() || null,
      p_university_id: input.university_id,
      p_program_of_study: input.program_of_study,
      p_date_of_birth: input.date_of_birth,
      p_father_of_confession: input.father_of_confession,
      p_home_address: input.home_address,
      p_gender: input.gender,
      p_move_requested: moveRequested,
    })
    .single();
  if (error) return { error: error.message, attendanceRecorded: false };
  const row = data as { attendance_recorded: boolean; newly_created: boolean } | null;
  return { error: null, attendanceRecorded: row?.attendance_recorded ?? false };
}

export async function submitNewMemberAction(token: string, input: NewMemberInput) {
  const validationError = validateIntake(input);
  if (validationError) return { error: validationError, attendanceRecorded: false };

  const supabase = await createClient();
  const { data, error } = await supabase
    .rpc("checkin_submit_new_member", {
      p_token: token,
      p_full_name: input.full_name.trim(),
      p_phone: formatPhone(input.phone ?? ""),
      p_email: input.email?.trim() ?? null,
      p_university_id: input.university_id,
      p_program_of_study: input.program_of_study,
      p_date_of_birth: input.date_of_birth,
      p_father_of_confession: input.father_of_confession,
      p_home_address: input.home_address,
      p_gender: input.gender,
      p_comments: input.comments,
    })
    .single();

  if (error) return { error: error.message, attendanceRecorded: false };
  const row = data as { member_id: string; attendance_recorded: boolean } | null;
  return { error: null, attendanceRecorded: row?.attendance_recorded ?? false };
}

/** `remember` reflects the owner-requested "Remember me on this device"
 * checkbox (default checked on the client) -- when true and the tap
 * succeeds, this device's cookie is updated to this person, so they're
 * pre-highlighted on future visits without searching again. The PREVIOUS
 * cookie value is captured and handed back so a following "Not you? Undo"
 * can restore it exactly (see undoServantAttendanceAction) -- a mis-tap
 * with the box checked shouldn't permanently overwrite whoever this
 * device already remembered. When `remember` is false (someone
 * deliberately checking in a person other than themselves), the cookie
 * is left untouched entirely. */
export async function markServantAttendanceAction(token: string, id: string, kind: "servant" | "pending", remember: boolean) {
  const supabase = await createClient();
  const { data, error } =
    kind === "servant"
      ? await supabase.rpc("checkin_mark_servant_attendance", { p_token: token, p_servant_id: id }).single()
      : await supabase.rpc("checkin_mark_pending_servant_attendance", { p_token: token, p_pending_servant_id: id }).single();
  const row = data as { attendance_recorded: boolean; newly_created: boolean } | null;

  let rememberedCookieWritten = false;
  let previousRemembered: string | null = null;
  if (!error && remember) {
    previousRemembered = await writeRememberCookie(SERVANT_CHECKIN_COOKIE, id, kind);
    rememberedCookieWritten = true;
  }

  return {
    error: error?.message ?? null,
    attendanceRecorded: row?.attendance_recorded ?? false,
    newlyCreated: row?.newly_created ?? false,
    rememberedCookieWritten,
    previousRemembered,
  };
}

/** Same mis-tap recovery as undoMemberAttendanceAction, for the Servants QR.
 * `restoreCookie` (from markServantAttendanceAction's result) undoes the
 * "Remember me" cookie write from that same tap, restoring whatever this
 * device remembered before it -- so undoing a mis-tap can't leave the
 * wrong person remembered for next week. */
export async function undoServantAttendanceAction(
  token: string,
  id: string,
  kind: "servant" | "pending",
  restoreCookie?: { rememberedCookieWritten: boolean; previousRemembered: string | null },
) {
  const supabase = await createClient();
  const { error } =
    kind === "servant"
      ? await supabase.rpc("checkin_undo_servant_attendance", { p_token: token, p_servant_id: id })
      : await supabase.rpc("checkin_undo_pending_servant_attendance", { p_token: token, p_pending_servant_id: id });

  if (!error && restoreCookie?.rememberedCookieWritten) {
    await restoreRememberCookie(SERVANT_CHECKIN_COOKIE, restoreCookie.previousRemembered);
  }

  return { error: error?.message ?? null };
}

export type NewServantInput = {
  full_name: string;
  phone: string | null;
  email: string | null;
  father_of_confession: string | null;
  gender: string | null;
  comments: string | null;
};

export async function submitNewServantAction(token: string, input: NewServantInput) {
  const validationError = validateIntake(input);
  if (validationError) return { error: validationError, attendanceRecorded: false };

  const supabase = await createClient();
  const { data, error } = await supabase
    .rpc("checkin_submit_new_servant", {
      p_token: token,
      p_full_name: input.full_name.trim(),
      p_phone: formatPhone(input.phone ?? ""),
      p_email: input.email?.trim() ?? null,
      p_father_of_confession: input.father_of_confession,
      p_gender: input.gender,
      p_comments: input.comments,
    })
    .single();

  if (error) return { error: error.message, attendanceRecorded: false };
  const row = data as { pending_id: string; attendance_recorded: boolean } | null;
  return { error: null, attendanceRecorded: row?.attendance_recorded ?? false };
}
