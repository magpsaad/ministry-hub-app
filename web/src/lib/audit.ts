import { after } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { ALL_COHORTS_GROUP_ID } from "@/lib/allCohorts";

/** Owner-decided (17 Oct 2026, migration 0119): the audit log keeps only
 * opening the app, role and access changes, deletions and group transitions
 * (the database also writes the check-in sign-up entries). Everything else
 * -- attendance, edits, photos, outreach, page views, calendar changes,
 * agreement signatures -- is no longer recorded, and there are no on/off
 * switches any more. Past entries of every type stay viewable. */
export type AuditActionType =
  | "APP_ACCESS"
  | "ADMIN_ACCESS_MAINTENANCE"
  | "SERVANT_GROUP_UPDATED"
  | "MEMBER_DELETED"
  | "SERVANT_DELETED"
  | "MEMBER_ARCHIVED"
  | "GROUP_TRANSITION_RUN";

/**
 * REQUIREMENTS.md §3.11/§6.14 -- writes one audit_log row for the given
 * action. Best-effort: a failure here never throws back into the calling action --
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
  // The combined view (the /g/all/* routes) passes the literal route param
  // "all" as groupId, which isn't a real group (group_id is a real FK to
  // groups(id)). Owner-requested (1 Oct 2026): instead of no group, record
  // the group of the youth the action was for, looked up from the details
  // (memberId or an outreach entryId) after the response is sent. Opening
  // the combined view itself (no youth) still records no group.
  const combined = opts?.groupId === ALL_COHORTS_GROUP_ID;
  const explicitGroupId = combined ? null : (opts?.groupId ?? null);

  try {
    // The Supabase client (which reads the request's cookies) is created
    // HERE, during the request -- Server Components can't read cookies
    // inside an after() callback. The insert itself runs via after(), once
    // the response has been sent.
    const supabase = await createClient();
    after(async () => {
      try {
        const groupId = combined ? await groupFromDetails(supabase, opts?.details) : explicitGroupId;
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

/** The group of the youth an action from the combined view was for. */
async function groupFromDetails(
  supabase: Awaited<ReturnType<typeof createClient>>,
  details: Record<string, unknown> | undefined,
): Promise<string | null> {
  const memberId = typeof details?.memberId === "string" ? details.memberId : null;
  if (memberId) {
    const { data } = await supabase.from("members").select("group_id").eq("id", memberId).maybeSingle();
    return data?.group_id ?? null;
  }
  const entryId = typeof details?.entryId === "string" ? details.entryId : null;
  if (entryId) {
    const { data } = await supabase.from("outreach_entries").select("member:members(group_id)").eq("id", entryId).maybeSingle();
    return (data?.member as unknown as { group_id: string } | null)?.group_id ?? null;
  }
  return null;
}
