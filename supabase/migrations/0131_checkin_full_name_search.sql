-- 0131_checkin_full_name_search.sql -- CHECK-IN: TYPE YOUR NAME UNTIL IT IS
-- YOURS ALONE (owner-requested 24 Nov 2026). The check-in search (0074)
-- showed up to 10 short names ("Mina H.") after any 3 letters. Now:
-- * The first word typed must be a whole word of the name (your first name,
--   in full); each later word must start a later word of the name, so
--   middle names can be skipped ("Mina Hanna" finds "Mina Ashraf Hanna").
-- * A name is shown only when what's typed fits ONE person -- then it is
--   shown in full, as stored. While it fits more than one, a single empty
--   row (no id, no name) says "keep typing"; nothing about who they are.
-- * Typing a whole name exactly picks that person even when it starts a
--   longer one ("Mina Hanna" when there is also a "Mina Hannalla").
-- * People whose names are exactly the same (same groups) can never be told
--   apart by typing, so they are all shown, as before.
-- Both the youths' QR (checkin_search_members) and the Servants QR
-- (checkin_search_servants); same signatures and grants, same check-in
-- hours, same speed limit. A phone's remembered "Check in as ..." is
-- unchanged (no typing after the first time).
-- Run once per environment, QA first:
--     begin; set local search_path to qa; \i 0131_checkin_full_name_search.sql; commit;
-- Undo with 0131_down_checkin_full_name_search.sql. Writes no audit entries.

do $mig$
declare
  s text := current_schema();
begin
  if s not in ('qa', 'prod') then
    raise exception 'Run with search_path set to qa or prod (got %)', s;
  end if;

  -- The typed name as a pattern over a lower-cased, single-spaced full
  -- name; '' while there's not enough to search (under 2 letters).
  execute format($f$
create or replace function %1$I.checkin_name_pattern(p_query text)
 returns text
 language plpgsql
 immutable
 set search_path to %1$I, 'public', 'pg_temp'
as $body$
declare
  v_trailing boolean := coalesce(p_query, '') ~ '\s$';
  v_words text[];
  v_p text;
  n integer;
  i integer;
begin
  if length(regexp_replace(coalesce(p_query, ''), '[^[:alpha:]]', '', 'g')) < 2 then return ''; end if;
  -- Every character that isn't a letter or digit is matched literally.
  select array_agg(regexp_replace(w, '([^[:alnum:]])', '\\\1', 'g') order by ord)
    into v_words
    from unnest(regexp_split_to_array(lower(btrim(regexp_replace(p_query, '\s+', ' ', 'g'))), ' ')) with ordinality as t(w, ord);
  n := array_length(v_words, 1);
  v_p := '(^| )' || v_words[1];
  if n = 1 then return v_p || '( |$)'; end if;
  v_p := v_p || ' (.* )?';
  for i in 2 .. n - 1 loop
    v_p := v_p || v_words[i] || ' (.* )?';
  end loop;
  return v_p || v_words[n] || case when v_trailing then '( |$)' else '' end;
end
$body$;
revoke all on function %1$I.checkin_name_pattern(text) from public, anon, authenticated;
grant execute on function %1$I.checkin_name_pattern(text) to service_role;
$f$, s);

  execute format($f$
create or replace function %1$I.checkin_search_members(p_token uuid, p_query text)
 returns table(member_id uuid, display_name text)
 language plpgsql
 security definer
 set search_path to %1$I, 'public', 'pg_temp'
as $body$
declare v_m text; v_group_id uuid; v_flow qr_flow_type;
  v_p text := checkin_name_pattern(p_query);
  v_q text := lower(btrim(regexp_replace(coalesce(p_query, ''), '\s+', ' ', 'g')));
begin
  select r_ministry_id, r_group_id, r_flow_type into v_m, v_group_id, v_flow from checkin_resolve(p_token);
  if v_group_id is null then raise exception 'Invalid check-in code'; end if;
  if v_flow <> 'check_in_and_intake' then raise exception 'This code does not support attendance check-in'; end if;
  if not checkin_open_any(v_m, checkin_served_groups(v_m, v_group_id)) then raise exception 'Check-in is closed'; end if;
  if v_p = '' then return; end if;
  perform checkin_throttle(v_m, 'search:' || p_token::text, 300, 10);
  return query
    with hits as (
      select m.id, m.full_name, lower(btrim(regexp_replace(m.full_name, '\s+', ' ', 'g'))) as nm
      from members m
      where m.ministry_id = v_m and m.status = 'active' and m.group_id = any(checkin_served_groups(v_m, v_group_id))
        and lower(btrim(regexp_replace(m.full_name, '\s+', ' ', 'g'))) ~ v_p),
    pick as (
      select h.* from hits h
      where (select count(distinct nm) from hits) = 1
         or (h.nm = v_q and (select count(distinct nm) from hits where nm = v_q) = 1))
    select p.id, p.full_name from pick p
    union all
    select null::uuid, null::text where exists (select 1 from hits) and not exists (select 1 from pick)
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
declare v_m text; v_group_id uuid;
  v_p text := checkin_name_pattern(p_query);
  v_q text := lower(btrim(regexp_replace(coalesce(p_query, ''), '\s+', ' ', 'g')));
begin
  select r_ministry_id, r_group_id into v_m, v_group_id from checkin_resolve(p_token);
  if v_group_id is not null then raise exception 'Invalid check-in code'; end if;
  if not checkin_open_any(v_m, null) then raise exception 'Check-in is closed'; end if;
  if v_p = '' then return; end if;
  perform checkin_throttle(v_m, 'search:' || p_token::text, 300, 10);
  return query
    with people as (
      select p.id as pid, p.full_name as fname, 'servant'::text as pkind from profiles p where p.ministry_id = v_m and p.deactivated_at is null and exists (select 1 from user_roles r where r.ministry_id = v_m and r.user_id = p.id)
      union all
      select ps.id, ps.full_name, 'pending'::text from pending_servants ps
      where ps.ministry_id = v_m and ps.resulting_profile_id is null
    ), hits as (
      select pid, fname, pkind, lower(btrim(regexp_replace(fname, '\s+', ' ', 'g'))) as nm from people
      where lower(btrim(regexp_replace(fname, '\s+', ' ', 'g'))) ~ v_p
    ), pick as (
      select h.* from hits h
      where (select count(distinct nm) from hits) = 1
         or (h.nm = v_q and (select count(distinct nm) from hits where nm = v_q) = 1))
    select p.pid, p.fname, p.pkind from pick p
    union all
    select null::uuid, null::text, null::text where exists (select 1 from hits) and not exists (select 1 from pick)
    order by 2;
end
$body$;
$f$, s);
end
$mig$;
