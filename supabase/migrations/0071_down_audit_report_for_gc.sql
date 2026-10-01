-- 0071_down_audit_report_for_gc.sql -- undoes 0071 (Audit Report back to
-- Admins only). Deploy the matching app code first or the Audit Report
-- page will fail to load.
--     begin; set local search_path to qa; \i 0071_down_audit_report_for_gc.sql; commit;

do $$
begin
  if current_schema() not in ('qa', 'prod') then
    raise exception 'Run with search_path set to qa or prod (got %)', current_schema();
  end if;
end
$$;

drop function if exists get_audit_report_rows();

create or replace function get_audit_log_users()
returns table(user_id uuid, full_name text) language plpgsql stable security definer as $$
#variable_conflict use_column
declare
  v_m text := current_ministry_id();
begin
  if not is_admin_in(v_m) then raise exception 'Only Admins can view audit log users'; end if;
  return query
    select distinct p.id, p.full_name
    from audit_log a
    join profiles p on p.ministry_id = a.ministry_id and p.id = a.user_id
    where a.ministry_id = v_m and a.user_id is not null;
end
$$;

do $$
begin
  execute format('alter function get_audit_log_users() set search_path = %I, public, pg_temp', current_schema());
end
$$;
