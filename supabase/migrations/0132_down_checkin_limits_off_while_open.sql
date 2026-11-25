-- 0132_down_checkin_limits_off_while_open.sql -- undoes 0132: the check-in
-- speed limits apply at all times again.
--     begin; set local search_path to qa; \i 0132_down_checkin_limits_off_while_open.sql; commit;

do $mig$
declare
  s text := current_schema();
begin
  if s not in ('qa', 'prod') then
    raise exception 'Run with search_path set to qa or prod (got %)', s;
  end if;

  execute format($f$
create or replace function %1$I.checkin_throttle(p_m text, p_scope text, p_limit integer, p_minutes integer)
 returns void
 language plpgsql
 security definer
 set search_path to %1$I, 'public', 'pg_temp'
as $body$
declare v_start timestamptz; v_hits integer;
begin
  v_start := date_bin(make_interval(mins => p_minutes), now(), timestamptz '2000-01-01 00:00:00+00');
  insert into checkin_throttle as t (ministry_id, scope, window_start, hits)
  values (p_m, p_scope, v_start, 1)
  on conflict (ministry_id, scope, window_start) do update set hits = t.hits + 1
  returning t.hits into v_hits;
  if random() < 0.01 then
    delete from checkin_throttle where window_start < now() - interval '1 day';
  end if;
  if v_hits > p_limit then
    raise exception 'Too many check-ins right now — please ask a servant.' using errcode = '54000';
  end if;
end
$body$;
$f$, s);
end
$mig$;
