-- 0131_down_checkin_full_name_search.sql -- undoes 0131: the check-in search
-- shows up to 10 short names ("Mina H.") after any 3 letters again.
--     begin; set local search_path to qa; \i 0131_down_checkin_full_name_search.sql; commit;

do $mig$
declare
  s text := current_schema();
begin
  if s not in ('qa', 'prod') then
    raise exception 'Run with search_path set to qa or prod (got %)', s;
  end if;

  execute format($f$
create or replace function %1$I.checkin_search_members(p_token uuid, p_query text)
 returns table(member_id uuid, display_name text)
 language plpgsql
 security definer
 set search_path to %1$I, 'public', 'pg_temp'
as $body$
declare v_m text; v_group_id uuid; v_flow qr_flow_type; v_q text := checkin_search_text(p_query);
begin
  select r_ministry_id, r_group_id, r_flow_type into v_m, v_group_id, v_flow from checkin_resolve(p_token);
  if v_group_id is null then raise exception 'Invalid check-in code'; end if;
  if v_flow <> 'check_in_and_intake' then raise exception 'This code does not support attendance check-in'; end if;
  if not checkin_open_any(v_m, checkin_served_groups(v_m, v_group_id)) then raise exception 'Check-in is closed'; end if;
  if v_q = '' then return; end if;
  perform checkin_throttle(v_m, 'search:' || p_token::text, 300, 10);
  return query
    with hits as (
      select m.id, m.full_name, checkin_short_name(m.full_name) as short
      from members m
      where m.ministry_id = v_m and m.status = 'active' and m.group_id = any(checkin_served_groups(v_m, v_group_id))
        and (lower(m.full_name) like v_q || '%%' or lower(m.full_name) like '%% ' || v_q || '%%')
      order by m.full_name
      limit 10)
    select h.id, case when count(*) over (partition by h.short) > 1 then checkin_short_name(h.full_name, true) else h.short end
    from hits h
    order by 2;
end
$body$;
$f$, s);

  execute format($f$
create or replace function %1$I.checkin_search_servants(p_token uuid, p_query text)
 returns table(id uuid, display_name text, kind text)
 language plpgsql
 security definer
 set search_path to %1$I, 'public', 'pg_temp'
as $body$
declare v_m text; v_group_id uuid; v_q text := checkin_search_text(p_query);
begin
  select r_ministry_id, r_group_id into v_m, v_group_id from checkin_resolve(p_token);
  if v_group_id is not null then raise exception 'Invalid check-in code'; end if;
  if not checkin_open_any(v_m, null) then raise exception 'Check-in is closed'; end if;
  if v_q = '' then return; end if;
  perform checkin_throttle(v_m, 'search:' || p_token::text, 300, 10);
  return query
    with people as (
      select p.id as pid, p.full_name as fname, 'servant'::text as pkind from profiles p where p.ministry_id = v_m and p.deactivated_at is null and exists (select 1 from user_roles r where r.ministry_id = v_m and r.user_id = p.id)
      union all
      select ps.id, ps.full_name, 'pending'::text from pending_servants ps
      where ps.ministry_id = v_m and ps.resulting_profile_id is null
    ), hits as (
      select pid, fname, pkind, checkin_short_name(fname) as short from people
      where lower(fname) like v_q || '%%' or lower(fname) like '%% ' || v_q || '%%'
      order by fname
      limit 10)
    select h.pid, case when count(*) over (partition by h.short) > 1 then checkin_short_name(h.fname, true) else h.short end, h.pkind
    from hits h
    order by 2;
end
$body$;
$f$, s);

  execute format('drop function if exists %I.checkin_name_pattern(text)', s);
end
$mig$;
