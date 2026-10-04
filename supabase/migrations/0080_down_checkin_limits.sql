-- 0080_down_checkin_limits.sql -- undoes 0080: the check-in functions go back to
-- the copies 0080 saved in <schema>_premm_backup.fn_backup_0080, and its tables
-- and helpers are dropped (the alert history in checkin_alerts goes with them;
-- the CHECKIN_* audit entries stay).
--     begin; set local search_path to qa; \i 0080_down_checkin_limits.sql; commit;

do $$
declare b text := current_schema() || '_premm_backup'; r record;
begin
  if current_schema() not in ('qa', 'prod') then
    raise exception 'Run with search_path set to qa or prod (got %)', current_schema();
  end if;
  for r in execute format('select sig, def, acl, volatile from %I.fn_backup_0080', b) loop
    execute r.def;
    execute format('alter function %s %s', r.sig, case r.volatile when 's' then 'stable' when 'i' then 'immutable' else 'volatile' end);
  end loop;
end
$$;

drop function if exists review_checkin_alert(uuid);
drop function if exists checkin_record_signup(text, text, uuid, text, uuid, text);
drop function if exists checkin_check_person(text, text, text, text, text, text, text, date, boolean);
drop function if exists checkin_throttle(text, text, integer, integer);
drop function if exists checkin_require_server();
drop table if exists checkin_alerts;
drop table if exists checkin_throttle;
drop table if exists checkin_guard;
