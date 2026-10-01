-- 0071_audit_report_for_gc.sql -- AUDIT REPORT FOR GENERAL COORDINATORS
-- (owner-requested, 30 Sep 2026). Run once per environment, QA first:
--     begin; set local search_path to qa; \i 0071_audit_report_for_gc.sql; commit;
-- Undo with 0071_down_audit_report_for_gc.sql.
--
-- The Audit Report (who was active, when) moves to the new "General
-- Coordinators" menu section and opens to General Coordinators too. The
-- audit log itself stays Admin-only (its details hold every changed field,
-- shown on the Admin-only Audit Logs page): General Coordinators get just
-- the report's columns -- when, and who -- through get_audit_report_rows().
-- Functions only: no tables, no locks on live data.

do $$
begin
  if current_schema() not in ('qa', 'prod') then
    raise exception 'Run with search_path set to qa or prod (got %)', current_schema();
  end if;
end
$$;

-- When and who, for the Audit Report: Admins and General Coordinators of
-- the current ministry. Paged by the app (order by occurred_at desc, id).
create or replace function get_audit_report_rows()
returns table(id bigint, occurred_at timestamptz, user_id uuid, user_name text)
language plpgsql stable security definer as $$
#variable_conflict use_column
declare
  v_m text := current_ministry_id();
begin
  if not is_admin_or_gc_in(v_m) then raise exception 'Only Admins and General Coordinators can view the audit report'; end if;
  return query
    select a.id, a.occurred_at, a.user_id, p.full_name
    from audit_log a
    left join profiles p on p.ministry_id = a.ministry_id and p.id = a.user_id
    where a.ministry_id = v_m;
end
$$;

-- The report's person filter: now Admins and General Coordinators.
create or replace function get_audit_log_users()
returns table(user_id uuid, full_name text) language plpgsql stable security definer as $$
#variable_conflict use_column
declare
  v_m text := current_ministry_id();
begin
  if not is_admin_or_gc_in(v_m) then raise exception 'Only Admins and General Coordinators can view audit log users'; end if;
  return query
    select distinct p.id, p.full_name
    from audit_log a
    join profiles p on p.ministry_id = a.ministry_id and p.id = a.user_id
    where a.ministry_id = v_m and a.user_id is not null;
end
$$;

-- Same pinning as 0064/0069: security definer functions run with this
-- schema first. Same access as the other functions (signed-in users and the
-- service role; a new function would otherwise be open to anyone).
do $$
begin
  execute format('alter function get_audit_report_rows() set search_path = %I, public, pg_temp', current_schema());
  execute format('alter function get_audit_log_users() set search_path = %I, public, pg_temp', current_schema());
  execute 'revoke all on function get_audit_report_rows() from public, anon';
  execute 'grant execute on function get_audit_report_rows() to authenticated, service_role';
end
$$;
