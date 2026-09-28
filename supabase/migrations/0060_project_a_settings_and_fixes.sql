-- 0060_project_a_settings_and_fixes.sql
-- Project A (MULTI_TENANT_PLAN.md §10): remove ministry-specific hard-coding
-- + small security clean-ups. Schema-agnostic like every other migration:
-- run once per environment with `set search_path to qa;` (then, only after
-- QA sign-off, `set search_path to prod;`). Function bodies are fully
-- schema-qualified via current_schema(), same pattern as 0043.
--
-- Safe to apply BEFORE the Project A code is deployed: every new column has
-- a default equal to today's hard-coded behaviour, and nothing the old code
-- calls is removed except mark_qr_code_printed (the old "Mark as Printed"
-- button would just show an error until the new code lands).

-- A9/A10/A12 -- values that used to be hard-coded in the app now live in
-- App Settings. Defaults reproduce today's behaviour exactly.
alter table app_settings
  add column if not exists theme_color_light text not null default '#2d5a7b',
  add column if not exists theme_color_dark  text not null default '#152a45',
  add column if not exists servants_qr_color text not null default '#9B2EBF',
  add column if not exists actions_needed_lookback_months integer not null default 12,
  add column if not exists ladder_position_label text not null default 'Yr';

alter table app_settings drop constraint if exists app_settings_lookback_months_check;
alter table app_settings add constraint app_settings_lookback_months_check
  check (actions_needed_lookback_months between 1 and 120);

alter table app_settings drop constraint if exists app_settings_theme_colors_check;
alter table app_settings add constraint app_settings_theme_colors_check check (
  theme_color ~ '^#[0-9A-Fa-f]{6}$'
  and theme_color_light ~ '^#[0-9A-Fa-f]{6}$'
  and theme_color_dark ~ '^#[0-9A-Fa-f]{6}$'
  and servants_qr_color ~ '^#[0-9A-Fa-f]{6}$'
);

do $$
declare
  v_schema text := current_schema();
begin
  -- P2 -- was callable without signing in, with no permission check, and
  -- returned every audit-log user's name. Now Admins only.
  execute format($outer$
    create or replace function %1$I.get_audit_log_users()
    returns table(user_id uuid, full_name text)
    language plpgsql stable security definer set search_path = %1$I, public as $fn$
    #variable_conflict use_column
    begin
      if not %1$I.is_admin() then
        raise exception 'Only Admins can view audit log users';
      end if;
      return query
        select distinct p.id, p.full_name
        from %1$I.audit_log a
        join %1$I.profiles p on p.id = a.user_id
        where a.user_id is not null;
    end;
    $fn$;
  $outer$, v_schema);
  execute format('revoke execute on function %1$I.get_audit_log_users() from public, anon', v_schema);
  execute format('grant execute on function %1$I.get_audit_log_users() to authenticated', v_schema);

  -- P4 -- any signed-in user (even one never approved) could list every
  -- QR check-in link. Now approved app users only. Same columns as before.
  execute format($outer$
    create or replace function %1$I.get_qr_codes_with_groups()
    returns table(id uuid, label text, check_in_token uuid, printed_at timestamptz,
                  updated_at timestamptz, group_id uuid, ladder_position integer, qr_color text)
    language sql stable security definer set search_path = %1$I, public as $fn$
      select q.id, q.label, q.check_in_token, q.printed_at, q.updated_at, q.group_id,
             g.ladder_position::integer, g.qr_color
      from %1$I.qr_codes q
      left join %1$I.groups g on g.id = q.group_id
      where %1$I.is_app_user();
    $fn$;
  $outer$, v_schema);
  execute format('revoke execute on function %1$I.get_qr_codes_with_groups() from public, anon', v_schema);
  execute format('grant execute on function %1$I.get_qr_codes_with_groups() to authenticated', v_schema);

  -- P3 -- "Mark as Printed" is not needed; QR codes stay printable at will.
  -- (qr_codes.printed_at is left in place for now and dropped in Project B's
  -- contract step, so this file never breaks a read the old code still does.)
  execute format('drop function if exists %1$I.mark_qr_code_printed(uuid)', v_schema);
end
$$;

notify pgrst, 'reload schema';
