import { after } from "next/server";
import { createClient } from "@/lib/supabase/server";

export type AuditActionType =
  | "APP_ACCESS"
  | "GROUP_SELECTED"
  | "MEMBER_EDITED"
  | "SERVANT_ASSIGNED"
  | "OUTREACH_ADDED"
  | "OUTREACH_UPDATED"
  | "OUTREACH_DELETED"
  | "MEMBER_PHOTO_UPLOADED"
  | "SERVANT_PROFILES_VIEWED"
  | "SERVANT_ATTENDANCE_VIEWED"
  | "SERVANT_EDITED"
  | "SERVANT_GROUP_UPDATED"
  | "SERVANT_PHOTO_UPLOADED"
  | "SERVANT_DELETED"
  | "ADMIN_ACCESS_MAINTENANCE"
  | "ADMIN_UNIVERSITIES_MAINTENANCE"
  | "ATTENDANCE_ADDED"
  | "ATTENDANCE_REMOVED"
  | "CALENDAR_EVENT_CREATED"
  | "CALENDAR_EVENT_UPDATED"
  | "CALENDAR_EVENT_DELETED"
  | "MEMBER_ARCHIVED"
  | "MEMBER_DELETED"
  | "GROUP_TRANSITION_RUN";

/**
 * REQUIREMENTS.md §3.11/§6.14 -- writes one audit_log row for the given
 * action, honoring audit_config's per-action-type enable/disable switch
 * (silently skips if that type is turned off). Best-effort: a failure here
 * (including "type disabled") never throws back into the calling action --
 * the underlying app operation this is attached to must always succeed
 * regardless of audit logging's own state.
 *
 * Runs after the response is sent (next/server after()), so it never slows
 * down the page or action it's attached to.
 *
 * Takes the caller's userId explicitly rather than calling
 * `supabase.auth.getUser()` itself, since every call site already has it on
 * hand -- avoids reintroducing the redundant-auth-call performance bug fixed
 * earlier in this project.
 */
export async function logAudit(
  userId: string,
  actionType: AuditActionType,
  opts?: { groupId?: string | null; details?: Record<string, unknown> },
): Promise<void> {
  // The "Load Data for all cohorts" combined view (§ the /g/all/* routes)
  // passes the literal route param "all" as groupId through every call
  // site that already threads groupId into logAudit -- normalized to null
  // here, once, rather than patching each call site, since group_id is a
  // real FK to groups(id) and "all" isn't a real group.
  const groupId = opts?.groupId === "all" ? null : (opts?.groupId ?? null);

  try {
    // The Supabase client (which reads the request's cookies) is created
    // HERE, during the request -- Server Components can't read cookies
    // inside an after() callback. The two audit queries themselves run via
    // after(), once the response has been sent, so logging no longer adds
    // two round trips to every page load and every save.
    const supabase = await createClient();
    after(async () => {
      try {
        const { data: config } = await supabase
          .from("audit_config")
          .select("enabled")
          .eq("action_type", actionType)
          .maybeSingle();
        if (config && config.enabled === false) return;

        await supabase.from("audit_log").insert({
          user_id: userId,
          action_type: actionType,
          group_id: groupId,
          details: opts?.details ?? null,
        });
      } catch {
        // Best-effort -- never let audit logging break the underlying action.
      }
    });
  } catch {
    // Best-effort -- never let audit logging break the underlying action.
  }
}
