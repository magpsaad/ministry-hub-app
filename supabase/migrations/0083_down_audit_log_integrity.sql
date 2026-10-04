-- 0083_down_audit_log_integrity.sql -- undoes 0083 (any app user may again add an
-- audit entry under any name and time).
--     begin; set local search_path to qa; \i 0083_down_audit_log_integrity.sql; commit;

do $$
begin
  if current_schema() not in ('qa', 'prod') then
    raise exception 'Run with search_path set to qa or prod (got %)', current_schema();
  end if;
end
$$;

drop trigger if exists trg_audit_log_stamp_time on audit_log;
drop function if exists audit_log_stamp_time();

drop policy if exists audit_log_insert on audit_log;
create policy audit_log_insert on audit_log for insert
  with check ((ministry_id = (select current_ministry_id())) and (select is_app_user()));
