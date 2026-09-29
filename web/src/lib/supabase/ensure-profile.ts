import type { User } from "@supabase/supabase-js";
import { createClient } from "@/lib/supabase/server";

/**
 * Lazily provisions this user's `profiles` row in the CURRENT schema
 * (qa or prod, per NEXT_PUBLIC_APP_ENV) if one doesn't exist yet -- for THIS
 * ministry only: profiles are per ministry (MULTI_TENANT_PLAN.md D7), so a
 * person's first sign-in on a ministry's address gives them a separate
 * profile there. The lookup below only sees this ministry's rows, and the
 * insert's ministry_id defaults to this address's ministry.
 *
 * Replaces the auth.users trigger approach (see 0002_core_tables.sql for
 * why): auth.users is shared across both schemas, so only the app itself --
 * which always knows which environment it is -- can reliably decide which
 * schema's profiles table a given sign-in belongs to.
 *
 * Safe to call on every authenticated request; it's a single indexed lookup
 * plus an insert only on the very first sign-in.
 */
export async function ensureProfile(user: User): Promise<void> {
  const supabase = await createClient();

  const { data: existing } = await supabase
    .from("profiles")
    .select("id")
    .eq("id", user.id)
    .maybeSingle();

  if (!existing) {
    const fullName =
      (user.user_metadata?.full_name as string | undefined) ??
      (user.user_metadata?.name as string | undefined) ??
      user.email ??
      "Unnamed User";

    await supabase.from("profiles").insert({
      id: user.id,
      full_name: fullName,
      email: user.email,
      photo_path: (user.user_metadata?.avatar_url as string | undefined) ?? null,
    });
  }

  // Phase C servant self-registration: a no-op unless an Admin/General
  // Coordinator has approved a pending_servants row matching this email
  // (see 0014_servant_self_registration.sql's link_approved_pending_servant
  // for the full linking logic -- security definer, since this runs under
  // the newly-signed-in user's own session, which has no RLS access to
  // pending_servants or to insert into user_roles on its own). Owner-
  // reported bug: this used to sit inside the `if (!existing)` branch above,
  // so it only ever ran the very first time a given auth account's profile
  // was created -- an approval that lands any time AFTER that (the normal
  // case: register, THEN get approved, THEN next sign-in) never linked,
  // silently, no error anywhere. 0014's own comment already said this
  // should run "for EVERY sign-in (not just servants)" -- it just didn't,
  // until now. Safe to call unconditionally: the RPC itself is idempotent
  // (resulting_profile_id is null / on conflict do nothing).
  if (user.email) {
    await supabase.rpc("link_approved_pending_servant", { p_email: user.email });
  }
}
