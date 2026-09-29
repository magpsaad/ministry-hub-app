-- Project B isolation test (V4). Run AFTER 0064 (and 0065) inside the same
-- rolled-back rehearsal transaction. Creates a throwaway ministry "TST"
-- (groups, a checked-in member, a person who serves in both ministries)
-- and tries to see or change one ministry's data from the other.
-- Results go into mm_iso(test, passed, detail); nothing survives the
-- rollback.

create temp table mm_iso (n serial, test text, passed boolean, detail text) on commit drop;
grant all on mm_iso to public;
grant all on sequence mm_iso_n_seq to public;

create function pg_temp.mm_act(p_uid uuid, p_header text) returns void language plpgsql as $f$
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

create function pg_temp.mm_back() returns void language plpgsql as $f$
begin
  perform set_config('role', 'none', true);
  perform set_config('request.jwt.claims', '', true);
  perform set_config('request.headers', '', true);
end
$f$;

create function pg_temp.mm_ok(p_test text, p_passed boolean, p_detail text default null) returns void language sql as $f$
  insert into mm_iso (test, passed, detail) values (p_test, coalesce(p_passed, false), p_detail);
$f$;

do $iso$
declare
  v_owner uuid; v_dual uuid; v_dual_email text; v_say_admin uuid;
  v_say_tok uuid; v_say_member uuid; v_say_member_name text; v_say_group uuid;
  v_tst_g1 uuid; v_tst_tok_g1 uuid; v_tst_tok_serv uuid; v_tst_member uuid;
  h_groups text; h_members text; h_roles text; h_qr text; n_audit bigint; n_dual_say_roles bigint;
  n bigint; n2 bigint; v_err text; n_tst_profiles bigint; n_say_members bigint;
begin
  -- Cast.
  select user_id into v_owner from church_admins limit 1;
  select ur.user_id into v_dual from user_roles ur
  where ur.role = 'servant' and ur.group_id is not null
    and not exists (select 1 from user_roles x where x.user_id = ur.user_id and x.role <> 'servant')
    and not exists (select 1 from church_admins c where c.user_id = ur.user_id)
    and exists (select 1 from members m where m.group_id = ur.group_id and m.status = 'active')
  order by ur.user_id limit 1;
  select email into v_dual_email from auth.users where id = v_dual;
  select user_id into v_say_admin from user_roles
  where role = 'admin' and user_id not in (select user_id from church_admins) order by user_id limit 1;
  select check_in_token, group_id into v_say_tok, v_say_group from qr_codes
  where ministry_id = 'SAY' and group_id is not null and flow_type = 'check_in_and_intake' order by label limit 1;
  select id, full_name into v_say_member, v_say_member_name from members
  where group_id = v_say_group and status = 'active' order by id limit 1;
  select count(*) into n_dual_say_roles from user_roles where ministry_id = 'SAY' and user_id = v_dual;

  h_groups  := (select md5(string_agg(row(g.*)::text, '|' order by g.id)) from groups g where ministry_id = 'SAY');
  h_members := (select md5(string_agg(row(m.*)::text, '|' order by m.id)) from members m where ministry_id = 'SAY');
  h_roles   := (select md5(string_agg(row(u.*)::text, '|' order by u.id)) from user_roles u where ministry_id = 'SAY');
  h_qr      := (select md5(string_agg(row(q.*)::text, '|' order by q.id)) from qr_codes q where ministry_id = 'SAY');
  n_audit   := (select count(*) from audit_log where ministry_id = 'SAY');

  -- Church Admin creates TST (the dual person becomes its first Admin) and two tiers.
  perform pg_temp.mm_act(v_owner, 'SAY');
  perform create_ministry('TST', 'Test Ministry', array['tst.test'], array[v_dual_email], 'TST Grade 0',
                          '{"group_label":"Grade","member_label":"Student","timezone":"America/Toronto","group_name_template":"{cohort_year} Grade {position_label}"}'::jsonb,
                          'SAY');
  perform pg_temp.mm_back();
  -- The Church Admin gets a TST profile the first time they sign in on its address.
  insert into profiles (ministry_id, id, full_name, email) select 'TST', id, 'Church Admin', email from auth.users where id = v_owner;
  perform pg_temp.mm_act(v_owner, 'TST');
  v_tst_g1 := add_group_tier(2030, 'TST Grade 1', '#123456');
  perform add_group_tier(2029, 'TST Grade 2', '#654321');
  perform pg_temp.mm_back();
  select check_in_token into v_tst_tok_g1 from qr_codes where ministry_id = 'TST' and group_id = v_tst_g1;
  select check_in_token into v_tst_tok_serv from qr_codes where ministry_id = 'TST' and group_id is null;
  perform pg_temp.mm_ok('TST created with settings, 3 groups, 3 QR codes, audit switches, thresholds',
    (select count(*) from groups where ministry_id = 'TST') = 3 and (select count(*) from qr_codes where ministry_id = 'TST') = 4
    and (select count(*) from audit_config where ministry_id = 'TST') = 24 and (select count(*) from actions_needed_config where ministry_id = 'TST') = 4
    and (select group_label from app_settings where ministry_id = 'TST') = 'Grade');

  -- Anonymous QR check-in on TST.
  n_tst_profiles := (select count(*) from profiles where ministry_id = 'TST');
  n_say_members := (select count(*) from members where ministry_id = 'SAY');
  perform pg_temp.mm_act(null, null);
  select member_id into v_tst_member from checkin_submit_new_member(v_tst_tok_g1, 'Test Kid', '1 (555) 000-0000', 'kid@test.test');
  select count(*) into n from checkin_list_members(v_tst_tok_g1);
  perform pg_temp.mm_ok('TST QR lists only TST members', n = 1, n::text);
  select count(*) into n from checkin_find_possible_duplicate_member(v_tst_tok_g1, v_say_member_name, null, null);
  perform pg_temp.mm_ok('TST QR duplicate search never finds a SAY member', n = 0, n::text);
  select count(*) into n from checkin_list_servants(v_tst_tok_serv);
  perform pg_temp.mm_ok('TST Servants QR lists only TST people', n = n_tst_profiles, n::text);
  begin
    perform checkin_mark_attendance(v_tst_tok_g1, v_say_member);
    perform pg_temp.mm_ok('TST QR cannot check in a SAY member', false, 'no error');
  exception when others then perform pg_temp.mm_ok('TST QR cannot check in a SAY member', true, sqlerrm); end;
  begin
    perform checkin_mark_attendance(v_say_tok, v_tst_member);
    perform pg_temp.mm_ok('SAY QR cannot check in a TST member', false, 'no error');
  exception when others then perform pg_temp.mm_ok('SAY QR cannot check in a TST member', true, sqlerrm); end;
  begin
    perform checkin_resolve_duplicate_member(v_tst_tok_g1, v_say_member, true);
    perform pg_temp.mm_ok('TST QR cannot move a SAY member into TST', false, 'no error');
  exception when others then perform pg_temp.mm_ok('TST QR cannot move a SAY member into TST', true, sqlerrm); end;
  perform pg_temp.mm_back();

  -- The dual person: TST Admin + SAY servant.
  perform pg_temp.mm_act(v_dual, 'TST');
  select count(*) into n from members;
  perform pg_temp.mm_ok('Dual person on TST sees only TST members', n = 1, n::text);
  select count(*) into n from groups;
  perform pg_temp.mm_ok('Dual person on TST sees only TST groups', n = 3, n::text);
  select count(*) into n from user_roles where ministry_id <> 'TST';
  perform pg_temp.mm_ok('Dual person on TST sees no SAY role grants', n = 0, n::text);
  select count(*) into n from profiles where ministry_id <> 'TST';
  perform pg_temp.mm_ok('Dual person on TST sees no SAY profiles', n = 0, n::text);
  perform pg_temp.mm_act(v_dual, 'SAY');
  select count(*) into n from members where ministry_id = 'TST';
  select count(*) into n2 from members;
  perform pg_temp.mm_ok('Dual person on SAY sees no TST members (and still sees SAY ones)', n = 0 and n2 > 0, n || '/' || n2);
  select count(*) into n from groups where ladder_position = 0;
  perform pg_temp.mm_ok('Dual person on SAY is not an Admin there (no pre-entry group)', n = 0, n::text);
  perform pg_temp.mm_back();

  -- A SAY Admin (not Church Admin) pointed at TST: sees and changes nothing.
  perform pg_temp.mm_act(v_say_admin, 'TST');
  select (select count(*) from members) + (select count(*) from groups) + (select count(*) from profiles)
       + (select count(*) from user_roles) + (select count(*) from attendance_records) + (select count(*) from outreach_entries)
       + (select count(*) from audit_log) + (select count(*) from pending_servants) + (select count(*) from qr_codes)
       + (select count(*) from verses) + (select count(*) from service_calendar_events)
  into n;
  perform pg_temp.mm_ok('SAY Admin with a faked TST header sees nothing', n = 0, n::text);
  update members set full_name = 'x' where ministry_id = 'TST';
  get diagnostics n = row_count;
  perform pg_temp.mm_ok('SAY Admin with a faked TST header changes nothing', n = 0, n::text);
  begin
    perform run_group_transition(2031);
    perform pg_temp.mm_ok('SAY Admin cannot run TST Group Transition', false, 'no error');
  exception when others then perform pg_temp.mm_ok('SAY Admin cannot run TST Group Transition', true, sqlerrm); end;
  perform pg_temp.mm_act(v_say_admin, 'SAY');
  begin
    insert into members (ministry_id, group_id, full_name) values ('TST', v_tst_g1, 'Sneaky');
    perform pg_temp.mm_ok('SAY Admin cannot insert into TST', false, 'no error');
  exception when others then perform pg_temp.mm_ok('SAY Admin cannot insert into TST', true, sqlerrm); end;
  begin
    perform create_ministry('XXX', 'Nope', null, array[v_dual_email], 'X');
    perform pg_temp.mm_ok('Ministry Admin cannot create ministries', false, 'no error');
  exception when others then perform pg_temp.mm_ok('Ministry Admin cannot create ministries', true, sqlerrm); end;
  begin
    perform * from list_ministries();
    perform pg_temp.mm_ok('Ministry Admin cannot list ministries', false, 'no error');
  exception when others then perform pg_temp.mm_ok('Ministry Admin cannot list ministries', true, sqlerrm); end;
  begin
    perform * from ministries;
    perform pg_temp.mm_ok('Nobody reads the ministries table directly', false, 'no error');
  exception when others then perform pg_temp.mm_ok('Nobody reads the ministries table directly', true, sqlerrm); end;
  perform pg_temp.mm_back();

  perform pg_temp.mm_act(null, null);
  select count(*) into n from resolve_ministry_by_address('tst.test');
  select count(*) into n2 from resolve_ministry_by_address('not-a-real-address.example');
  perform pg_temp.mm_ok('Address lookup: one match, unknown address none', n = 1 and n2 = 0, n || '/' || n2);
  perform pg_temp.mm_act(null, 'TST');
  begin
    select count(*) into n from members;
    perform pg_temp.mm_ok('Signed-out visitor sees no members', n = 0, n::text);
  exception when insufficient_privilege then
    perform pg_temp.mm_ok('Signed-out visitor sees no members', true, 'no access at all');
  end;
  perform pg_temp.mm_back();

  -- The database itself refuses cross-ministry links (as the owner, bypassing every rule).
  begin
    insert into members (ministry_id, group_id, full_name) values ('TST', v_say_group, 'Cross');
    perform pg_temp.mm_ok('Database refuses a TST member in a SAY group', false, 'no error');
  exception when foreign_key_violation then perform pg_temp.mm_ok('Database refuses a TST member in a SAY group', true, sqlerrm); end;
  begin
    insert into attendance_records (ministry_id, attendee_type, member_id, service_date) values ('TST', 'member', v_say_member, date '2020-01-01');
    perform pg_temp.mm_ok('Database refuses TST attendance for a SAY member', false, 'no error');
  exception when foreign_key_violation then perform pg_temp.mm_ok('Database refuses TST attendance for a SAY member', true, sqlerrm); end;
  begin
    insert into user_roles (ministry_id, user_id, role, group_id) values ('TST', v_say_admin, 'servant', v_say_group);
    perform pg_temp.mm_ok('Database refuses a TST role pointing at a SAY group', false, 'no error');
  exception when foreign_key_violation then perform pg_temp.mm_ok('Database refuses a TST role pointing at a SAY group', true, sqlerrm); end;

  -- Big functions run in TST leave SAY byte-for-byte untouched.
  perform pg_temp.mm_act(v_owner, 'TST');
  perform run_group_transition(2031);
  perform archive_audit_log(date '2100-01-01');
  perform grant_servant_role(v_dual, 'servant', v_tst_g1);
  perform remove_servant(v_dual);
  perform pg_temp.mm_back();
  perform pg_temp.mm_ok('TST Group Transition ran (TST has a new Grade 0)',
    (select count(*) from groups where ministry_id = 'TST' and ladder_position = 0 and not is_archived) = 1
    and (select count(*) from groups where ministry_id = 'TST') = 4);
  perform pg_temp.mm_ok('SAY groups untouched', h_groups = (select md5(string_agg(row(g.*)::text, '|' order by g.id)) from groups g where ministry_id = 'SAY'));
  perform pg_temp.mm_ok('SAY members untouched', h_members = (select md5(string_agg(row(m.*)::text, '|' order by m.id)) from members m where ministry_id = 'SAY'));
  perform pg_temp.mm_ok('SAY role grants untouched (incl. the dual person)', h_roles = (select md5(string_agg(row(u.*)::text, '|' order by u.id)) from user_roles u where ministry_id = 'SAY')
    and n_dual_say_roles = (select count(*) from user_roles where ministry_id = 'SAY' and user_id = v_dual));
  perform pg_temp.mm_ok('SAY QR codes untouched', h_qr = (select md5(string_agg(row(q.*)::text, '|' order by q.id)) from qr_codes q where ministry_id = 'SAY'));
  perform pg_temp.mm_ok('SAY audit log untouched by TST archive', n_audit = (select count(*) from audit_log where ministry_id = 'SAY'));

  -- Church Admin sees each ministry, one at a time.
  perform pg_temp.mm_act(v_owner, 'TST');
  select count(*) into n from members;
  perform pg_temp.mm_act(v_owner, 'SAY');
  select count(*) into n2 from members;
  perform pg_temp.mm_ok('Church Admin sees TST on TST and SAY on SAY, never both',
    n = 1 and n2 = n_say_members + 0, n || '/' || n2);

  -- Inactive ministry: its people are locked out, its QR codes stop working, the Church Admin still gets in.
  perform set_ministry_active('TST', false);
  perform pg_temp.mm_act(v_dual, 'TST');
  select count(*) into n from members;
  perform pg_temp.mm_ok('Inactive TST: its Admin sees nothing', n = 0, n::text);
  perform pg_temp.mm_act(null, null);
  begin
    perform checkin_list_members(v_tst_tok_g1);
    perform pg_temp.mm_ok('Inactive TST: its QR codes stop working', false, 'no error');
  exception when others then perform pg_temp.mm_ok('Inactive TST: its QR codes stop working', true, sqlerrm); end;
  perform pg_temp.mm_act(v_owner, 'TST');
  select count(*) into n from members;
  perform pg_temp.mm_ok('Inactive TST: Church Admin still sees it', n = 1, n::text);
  perform pg_temp.mm_back();
end
$iso$;
