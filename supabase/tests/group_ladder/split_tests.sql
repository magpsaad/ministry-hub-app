-- SAY split tests (GROUP_LADDER_PLAN.md §7: V8 shared code, V9). Run AFTER
-- 0069 and 0070 inside the same rolled-back rehearsal transaction, as the
-- database owner. Results go into st(test, passed, detail).

create temp table st (n serial, test text, passed boolean, detail text) on commit drop;
grant all on st to public;
grant all on sequence st_n_seq to public;

create function pg_temp.st_act(p_uid uuid, p_header text) returns void language plpgsql as $f$
begin
  perform set_config('role', 'none', true);
  perform set_config('request.headers', case when p_header is null then '' else json_build_object('x-ministry-id', p_header)::text end, true);
  if p_uid is null then
    perform set_config('request.jwt.claims', '{"role":"anon"}', true);
    perform set_config('role', 'anon', true);
  else
    perform set_config('request.jwt.claims', json_build_object('sub', p_uid, 'role', 'authenticated')::text, true);
    perform set_config('role', 'authenticated', true);
  end if;
end
$f$;

create function pg_temp.st_back() returns void language plpgsql as $f$
begin
  perform set_config('role', 'none', true);
  perform set_config('request.jwt.claims', '', true);
  perform set_config('request.headers', '', true);
end
$f$;

create function pg_temp.st_ok(p_test text, p_passed boolean, p_detail text default null) returns void language sql as $f$
  insert into st (test, passed, detail) values (p_test, coalesce(p_passed, false), p_detail);
$f$;

do $t$
declare
  v_owner uuid; v_gc uuid;
  y5 uuid; y6 uuid; ho uuid; y3 uuid; v_tok uuid; v_y3_member uuid;
  v_kristeen constant uuid := '907cf923-f0e9-4980-af44-cd889dae6f84';
  v_mike     constant uuid := '0813ff33-dd76-40b0-b976-0b6ee3e19b21';
  n bigint; n2 bigint; v_txt text; r jsonb; v_id uuid; v_dob date; v_expect text; v_got text;
begin
  select user_id into v_owner from church_admins limit 1;
  select user_id into v_gc from user_roles ur where ministry_id = 'SAY' and role = 'general_coordinator'
    and not exists (select 1 from user_roles x where x.user_id = ur.user_id and x.ministry_id = 'SAY' and x.role = 'admin')
    and not exists (select 1 from church_admins c where c.user_id = ur.user_id) order by user_id limit 1;
  select id into y5 from groups where ministry_id = 'SAY' and name = '2004 - Yr 5' and not is_archived;
  select id into y6 from groups where ministry_id = 'SAY' and name = '2003 - Yr 6' and not is_archived;
  select id into ho from groups where ministry_id = 'SAY' and name = '2002 - Transitioning' and not is_archived;
  select id into y3 from groups where ministry_id = 'SAY' and kind = 'regular' and ladder_position = 3 and not is_archived;
  select check_in_token into v_tok from qr_codes where group_id = y5;

  perform pg_temp.st_ok('V9 three groups exist', y5 is not null and y6 is not null and ho is not null,
    (select string_agg(name || ':' || kind || ':' || ladder_position, ' | ' order by display_order)
     from groups where ministry_id = 'SAY' and not is_archived));
  perform pg_temp.st_ok('V9 counts by birth year',
    not exists (select 1 from members where group_id = y5 and status = 'active'
                and (date_of_birth is null or extract(year from date_of_birth) not in (2004, 2005)))
    and not exists (select 1 from members where group_id = y6 and status = 'active'
                    and date_of_birth is not null and extract(year from date_of_birth) <> 2003
                    and extract(year from date_of_birth) < 2024)
    and not exists (select 1 from members where group_id = ho and status = 'active' and extract(year from date_of_birth) > 2002),
    format('Yr 5 %s, Yr 6 %s, hand-over %s',
      (select count(*) from members where group_id = y5 and status = 'active'),
      (select count(*) from members where group_id = y6 and status = 'active'),
      (select count(*) from members where group_id = ho and status = 'active')));
  perform pg_temp.st_ok('V9 Yr 5 kept the old code; Yr 6 and hand-over share it',
    (select count(*) from qr_codes where group_id in (y5, y6, ho)) = 1
    and (select check_in_code_group_id from groups where id = y6) = y5
    and (select check_in_code_group_id from groups where id = ho) = y5
    and (select label from qr_codes where group_id = y5) = '2004 - Yr 5');
  perform pg_temp.st_ok('V9 Kristeen and Mike: Coordinator + Servant on Yr 5 and Yr 6',
    (select count(*) from user_roles where user_id in (v_kristeen, v_mike) and group_id in (y5, y6)
     and role in ('sub_coordinator', 'servant')) =
    4 * (select count(*) from profiles where ministry_id = 'SAY' and id in (v_kristeen, v_mike)),
    (select string_agg(p.full_name || ' ' || ur.role || ' ' || g.name, '; ') from user_roles ur
     join groups g on g.id = ur.group_id join profiles p on p.ministry_id = 'SAY' and p.id = ur.user_id
     where ur.user_id in (v_kristeen, v_mike) and g.id in (y5, y6)));
  perform pg_temp.st_ok('V9 every Read-Only on Yr 5 also on Yr 6',
    not exists (select 1 from user_roles a where a.group_id = y5 and a.role = 'read_only'
                and not exists (select 1 from user_roles b where b.group_id = y6 and b.role = 'read_only' and b.user_id = a.user_id)));
  perform pg_temp.st_ok('V9 hand-over has no grants and no assignments',
    not exists (select 1 from user_roles where group_id = ho)
    and not exists (select 1 from members where group_id = ho and assigned_servant_id is not null));
  execute format('select count(*) from %I.say_split_0070_members b join members m on m.id = b.id
                  where b.assigned_servant_id in ($1, $2) and m.assigned_servant_id is distinct from b.assigned_servant_id
                    and m.group_id <> $3', current_schema() || '_premm_backup')
    into n using v_kristeen, v_mike, ho;
  perform pg_temp.st_ok('V9 Kristeen''s and Mike''s assignments kept (outside hand-over)', n = 0, n::text);
  perform pg_temp.st_ok('V9 order and levels',
    (select string_agg(name, ' | ' order by display_order) from groups where ministry_id = 'SAY' and not is_archived)
      like '% | 2005 - Yr 4 | 2004 - Yr 5 | 2003 - Yr 6 | 2002 - Transitioning'
    and (select ladder_position from groups where id = y6) = 6 and (select ladder_position from groups where id = ho) = 7);

  -- The shared code (D13) as the public check-in page sees it.
  perform pg_temp.st_act(null, null);
  select count(*) into n from checkin_list_members(v_tok);
  perform pg_temp.st_back();
  select count(*) into n2 from members where group_id in (y5, y6, ho) and status = 'active';
  perform pg_temp.st_ok('V8 shared code lists Yr 5, Yr 6 and hand-over youths', n = n2, format('%s of %s', n, n2));
  select id into v_id from members where group_id = ho and status = 'active' order by id limit 1;
  perform pg_temp.st_act(null, null);
  begin
    perform checkin_mark_attendance(v_tok, v_id);
    v_txt := 'ok';
  exception when others then v_txt := sqlerrm;
  end;
  perform pg_temp.st_back();
  perform pg_temp.st_ok('V8 a hand-over youth can check in on the shared code', v_txt = 'ok', v_txt);

  -- Q11: new sign-ups placed by birth year.
  v_got := '';
  foreach v_dob in array array['2004-05-01', '2003-05-01', '2001-05-01', '2006-05-01', null, '2025-05-01']::date[] loop
    perform pg_temp.st_act(null, null);
    select member_id into v_id from checkin_submit_new_member(v_tok, 'ZZ New ' || coalesce(v_dob::text, 'nodate'),
      '5550000000', 'zz@example.invalid', null, null, v_dob, null, null, 'Male', null);
    perform pg_temp.st_back();
    v_got := v_got || (select case group_id when y5 then 'Y5' when y6 then 'Y6' when ho then 'HO' else '??' end
                       from members where id = v_id) || ' ';
  end loop;
  perform pg_temp.st_ok('Q11 placement 2004,2003,2001,2006,none,2025', trim(v_got) = 'Y5 Y6 HO Y5 Y6 Y6', v_got);

  -- "Is this you?": a youth from Yr 3 scanning the shared code is placed by
  -- birth year; one already in a sharing group is not moved.
  select id into v_y3_member from members where group_id = y3 and status = 'active' order by id limit 1;
  update members set date_of_birth = '2001-02-03' where id = v_y3_member;
  perform pg_temp.st_act(null, null);
  perform checkin_resolve_duplicate_member(v_tok, v_y3_member, true);
  perform pg_temp.st_back();
  perform pg_temp.st_ok('Q11 "Is this you?" move places by birth year', (select group_id from members where id = v_y3_member) = ho);
  select id into v_id from members where group_id = y6 and status = 'active' order by id limit 1;
  perform pg_temp.st_act(null, null);
  perform checkin_resolve_duplicate_member(v_tok, v_id, true);
  perform pg_temp.st_back();
  perform pg_temp.st_ok('Q11 "Is this you?" never moves within the sharing groups', (select group_id from members where id = v_id) = y6);

  -- Hidden from a General Coordinator; the transition is blocked.
  perform pg_temp.st_act(v_gc, 'SAY');
  select count(*) into n from members where group_id = ho;
  perform pg_temp.st_back();
  perform pg_temp.st_ok('V9 a GC does not see the hand-over youths', n = 0, n::text);
  perform pg_temp.st_act(v_owner, 'SAY');
  r := preview_group_transition(2010);
  select count(*) into n from members where group_id = ho and status = 'active';
  perform pg_temp.st_back();
  perform pg_temp.st_ok('V9 next SAY transition blocked by the hand-over youths', (r ->> 'blocked')::boolean
    and (r ->> 'occupant_count')::int = n, left(r::text, 300));
end
$t$;
