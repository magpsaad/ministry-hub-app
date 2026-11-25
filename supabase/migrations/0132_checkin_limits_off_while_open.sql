-- 0132_checkin_limits_off_while_open.sql -- NO CHECK-IN SPEED LIMITS WHILE
-- CHECK-IN IS OPEN (owner-requested 24 Nov 2026). Upper Room's first night:
-- the poster's 25 new registrations an hour (0080) ran out at 8 PM and
-- newcomers were turned away ("Too many check-ins right now"); the poster
-- and search limits were close behind. The limits are there to stop
-- someone hammering a poster link outside the service -- during the
-- ministry's check-in hours (or an event's check-in) they no longer count
-- or stop anything. Outside those times they apply as before.
-- Run once per environment, QA first:
--     begin; set local search_path to qa; \i 0132_checkin_limits_off_while_open.sql; commit;
-- Undo with 0132_down_checkin_limits_off_while_open.sql. Writes no audit entries.

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
  -- Check-in open (the ministry's hours or an event's): no limit.
  if checkin_open_any(p_m, null) then return; end if;
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
