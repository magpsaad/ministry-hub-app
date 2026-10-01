-- Group ladder tests (GROUP_LADDER_PLAN.md §7: V4, V5, V7, V8, V12). Run
-- AFTER 0069 inside the same rolled-back rehearsal transaction, as the
-- database owner, with search_path set to the schema under test. Results go
-- into lt(test, passed, detail); nothing survives the rollback.

create temp table lt (n serial, test text, passed boolean, detail text) on commit drop;
grant all on lt to public;
grant all on sequence lt_n_seq to public;

create function pg_temp.lt_act(p_uid uuid, p_header text) returns void language plpgsql as $f$
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

create function pg_temp.lt_back() returns void language plpgsql as $f$
begin
  perform set_config('role', 'none', true);
  perform set_config('request.jwt.claims', '', true);
  perform set_config('request.headers', '', true);
end
$f$;

create function pg_temp.lt_ok(p_test text, p_passed boolean, p_detail text default null) returns void language sql as $f$
  insert into lt (test, passed, detail) values (p_test, coalesce(p_passed, false), p_detail);
$f$;

do $t$
declare
  v_owner uuid; v_gc uuid; v_srv uuid; v_srv_group uuid; v_ro uuid; v_admin uuid;
  v_say_pre uuid; v_say_term uuid; v_say_reg uuid; v_say_reg_member uuid; v_say_term_tok uuid;
  v_tst_pre uuid; v_tst_term uuid; v_tst_pre_tok uuid; v_tst_term_tok uuid;
  v_hidden_youth uuid; v_pre_youth uuid; v_new uuid; v_new2 uuid; v_ids uuid[];
  r jsonb; r_prev jsonb; n bigint; n2 bigint; v_err text; v_txt text; v_lvl int; v_ord int;
begin
  -- Cast ---------------------------------------------------------------------
  select user_id into v_owner from church_admins limit 1;
  select user_id into v_gc from user_roles ur where ministry_id = 'SAY' and role = 'general_coordinator'
    and not exists (select 1 from user_roles x where x.user_id = ur.user_id and x.ministry_id = 'SAY' and x.role = 'admin')
    and not exists (select 1 from church_admins c where c.user_id = ur.user_id) order by user_id limit 1;
  select ur.user_id, ur.group_id into v_srv, v_srv_group from user_roles ur
  where ur.ministry_id = 'SAY' and ur.role = 'servant' and ur.group_id is not null
    and not exists (select 1 from user_roles x where x.user_id = ur.user_id and x.ministry_id = 'SAY'
                    and x.role in ('admin', 'general_coordinator'))
    and not exists (select 1 from church_admins c where c.user_id = ur.user_id)
    and exists (select 1 from members m where m.group_id = ur.group_id and m.status = 'active')
  order by ur.user_id limit 1;
  select user_id into v_ro from user_roles ur where ministry_id = 'SAY' and role = 'read_only'
    and not exists (select 1 from user_roles x where x.user_id = ur.user_id and x.ministry_id = 'SAY'
                    and x.role in ('admin', 'general_coordinator'))
    and not exists (select 1 from church_admins c where c.user_id = ur.user_id) order by user_id limit 1;
  select user_id into v_admin from user_roles ur where ministry_id = 'SAY' and role = 'admin'
    and not exists (select 1 from church_admins c where c.user_id = ur.user_id) order by user_id limit 1;
  perform pg_temp.lt_ok('cast found', v_owner is not null and v_gc is not null and v_srv is not null and v_ro is not null,
    format('owner %s gc %s servant %s ro %s admin %s', v_owner, v_gc, v_srv, v_ro, v_admin));

  select id into v_say_pre from groups where ministry_id = 'SAY' and kind = 'pre_entry' and not is_archived;
  select id into v_say_term from groups where ministry_id = 'SAY' and kind = 'terminal' and not is_archived order by created_at limit 1;
  select id into v_say_reg from groups where ministry_id = 'SAY' and kind = 'regular' and not is_archived order by ladder_position limit 1;
  select id into v_say_reg_member from members where group_id = v_say_reg and status = 'active' order by id limit 1;
  select id into v_tst_pre from groups where ministry_id = 'TST' and kind = 'pre_entry' and not is_archived;
  select id into v_tst_term from groups where ministry_id = 'TST' and kind = 'terminal' and not is_archived;
  select check_in_token into v_tst_pre_tok from qr_codes where group_id = v_tst_pre;
  select check_in_token into v_tst_term_tok from qr_codes where group_id = v_tst_term;
  select check_in_token into v_say_term_tok from qr_codes where group_id = v_say_term;

  -- Synthetic youths in SAY's hidden groups, with attendance and outreach.
  insert into members (ministry_id, group_id, full_name, gender) values ('SAY', v_say_term, 'ZZ Hidden Handover', 'Male')
  returning id into v_hidden_youth;
  insert into members (ministry_id, group_id, full_name, gender) values ('SAY', v_say_pre, 'ZZ Hidden Preentry', 'Female')
  returning id into v_pre_youth;
  insert into attendance_records (ministry_id, attendee_type, member_id, service_date)
  values ('SAY', 'member', v_hidden_youth, current_date - 7);
  insert into outreach_entries (ministry_id, member_id, servant_id) values ('SAY', v_hidden_youth, v_owner);

  -- V4: hidden groups are Admin-only in the database ------------------------
  perform pg_temp.lt_act(v_gc, 'SAY');
  select count(*) into n from members where id in (v_hidden_youth, v_pre_youth);
  perform pg_temp.lt_ok('V4 GC cannot read hidden youths', n = 0, n::text);
  select count(*) into n from groups where kind <> 'regular';
  perform pg_temp.lt_ok('V4 GC cannot see hidden group rows', n = 0, n::text);
  select count(*) into n from attendance_records where member_id = v_hidden_youth;
  perform pg_temp.lt_ok('V4 GC cannot read hidden attendance', n = 0, n::text);
  select count(*) into n from outreach_entries where member_id = v_hidden_youth;
  perform pg_temp.lt_ok('V4 GC cannot read hidden outreach', n = 0, n::text);
  select count(*) into n from members m join groups g on g.id = m.group_id where g.kind = 'regular' and m.status = 'active';
  perform pg_temp.lt_back();
  select count(*) into n2 from members m join groups g on g.id = m.group_id
  where g.ministry_id = 'SAY' and g.kind = 'regular' and m.status = 'active';
  perform pg_temp.lt_ok('V4 GC still reads every regular youth', n = n2, format('%s of %s', n, n2));

  perform pg_temp.lt_act(v_gc, 'SAY');
  begin
    update members set group_id = v_say_term where id = v_say_reg_member;
    get diagnostics n = row_count;
    v_err := 'updated ' || n;
  exception when others then v_err := sqlerrm; n := 0;
  end;
  perform pg_temp.lt_back();
  select count(*) into n2 from members where id = v_say_reg_member and group_id = v_say_term;
  perform pg_temp.lt_ok('V4 GC cannot move a youth into a hidden group', n2 = 0, v_err);

  perform pg_temp.lt_act(v_gc, 'SAY');
  begin
    insert into members (ministry_id, group_id, full_name) values ('SAY', v_say_term, 'ZZ GC insert');
    v_err := 'inserted';
  exception when others then v_err := sqlerrm;
  end;
  perform pg_temp.lt_ok('V4 GC cannot add a youth to a hidden group', v_err <> 'inserted', v_err);
  begin
    update members set full_name = full_name where id = v_hidden_youth;
    get diagnostics n = row_count;
    v_err := 'rows ' || n;
  exception when others then v_err := sqlerrm; n := 0;
  end;
  perform pg_temp.lt_ok('V4 GC cannot change a hidden youth', n = 0, v_err);
  begin
    delete from members where id = v_hidden_youth;
    get diagnostics n = row_count;
    v_err := 'rows ' || n;
  exception when others then v_err := sqlerrm; n := 0;
  end;
  perform pg_temp.lt_ok('V4 GC cannot delete a hidden youth', n = 0, v_err);
  begin
    insert into attendance_records (ministry_id, attendee_type, member_id, service_date)
    values ('SAY', 'member', v_hidden_youth, current_date - 14);
    v_err := 'inserted';
  exception when others then v_err := sqlerrm;
  end;
  perform pg_temp.lt_ok('V4 GC cannot record hidden attendance', v_err <> 'inserted', v_err);
  begin
    perform export_group_member_names(v_say_term);
    v_err := 'exported';
  exception when others then v_err := sqlerrm;
  end;
  perform pg_temp.lt_ok('V4 GC cannot export hidden names', v_err <> 'exported', v_err);
  begin
    perform add_member_photo(v_hidden_youth, 'SAY/members/x.png');
    v_err := 'photo';
  exception when others then v_err := sqlerrm;
  end;
  perform pg_temp.lt_ok('V4 GC cannot set a hidden youth''s photo', v_err <> 'photo', v_err);
  perform pg_temp.lt_back();

  perform pg_temp.lt_act(v_srv, 'SAY');
  select count(*) into n from members where id in (v_hidden_youth, v_pre_youth);
  perform pg_temp.lt_ok('V4 servant cannot read hidden youths', n = 0, n::text);
  select count(*) into n from members where group_id = v_srv_group;
  perform pg_temp.lt_ok('V4 servant still reads own group', n > 0, n::text);
  perform pg_temp.lt_back();
  if v_ro is not null then
    perform pg_temp.lt_act(v_ro, 'SAY');
    select count(*) into n from members where id in (v_hidden_youth, v_pre_youth);
    perform pg_temp.lt_ok('V4 read-only cannot read hidden youths', n = 0, n::text);
    perform pg_temp.lt_back();
  end if;
  if v_admin is not null then
    perform pg_temp.lt_act(v_admin, 'SAY');
    select count(*) into n from members where id in (v_hidden_youth, v_pre_youth);
    select count(*) into n2 from attendance_records where member_id = v_hidden_youth;
    perform pg_temp.lt_ok('V4 Admin reads hidden youths and attendance', n = 2 and n2 = 1, format('%s / %s', n, n2));
    perform pg_temp.lt_back();
  end if;
  perform pg_temp.lt_act(v_owner, 'SAY');
  select count(*) into n from members where id in (v_hidden_youth, v_pre_youth);
  perform pg_temp.lt_ok('V4 Church Admin reads hidden youths', n = 2, n::text);
  perform pg_temp.lt_back();

  begin
    insert into user_roles (ministry_id, user_id, role, group_id) values ('SAY', v_srv, 'servant', v_say_term);
    v_err := 'granted';
  exception when others then v_err := sqlerrm;
  end;
  perform pg_temp.lt_ok('V4 no role grant on a hidden group (even as owner)', v_err <> 'granted', v_err);

  -- V5: isolation and anonymous access ----------------------------------------
  perform pg_temp.lt_act(v_owner, 'TST');
  begin
    perform move_group(v_say_reg, 'down');
    v_err := 'moved';
  exception when others then v_err := sqlerrm;
  end;
  perform pg_temp.lt_ok('V5 TST request cannot move a SAY group', v_err <> 'moved', v_err);
  begin
    perform set_group_qr_active(v_say_term, false);
    v_err := 'switched';
  exception when others then v_err := sqlerrm;
  end;
  perform pg_temp.lt_ok('V5 TST request cannot switch a SAY QR', v_err <> 'switched', v_err);
  perform pg_temp.lt_back();
  perform pg_temp.lt_act(v_gc, 'SAY');
  begin
    perform add_group('ZZ by GC');
    v_err := 'added';
  exception when others then v_err := sqlerrm;
  end;
  perform pg_temp.lt_ok('V5 GC cannot add a group', v_err <> 'added', v_err);
  begin
    r := preview_group_transition(2027);
    v_err := 'previewed';
  exception when others then v_err := sqlerrm;
  end;
  perform pg_temp.lt_ok('V5 GC cannot preview a transition', v_err <> 'previewed', v_err);
  perform pg_temp.lt_back();
  perform pg_temp.lt_act(null, 'SAY');
  begin
    perform archive_terminal_members();
    v_err := 'archived';
  exception when others then v_err := sqlerrm;
  end;
  perform pg_temp.lt_ok('V5 anon cannot archive', v_err <> 'archived', v_err);
  perform pg_temp.lt_back();

  -- V8: check-in switches ---------------------------------------------------
  insert into members (ministry_id, group_id, full_name) values ('TST', v_tst_term, 'ZZ TST Handover');
  perform pg_temp.lt_act(null, null);
  select count(*) into n from checkin_list_members(v_tst_term_tok);
  perform pg_temp.lt_ok('V8 hand-over QR lists its youths', n = 1, n::text);
  begin
    perform checkin_get_flow(v_tst_pre_tok);
    v_err := 'resolved';
  exception when others then v_err := sqlerrm;
  end;
  perform pg_temp.lt_ok('V8 switched-off pre-entry code refuses', v_err like '%isn''t active%', v_err);
  perform pg_temp.lt_back();
  perform pg_temp.lt_act(v_owner, 'TST');
  perform set_group_qr_active(v_tst_pre, true);
  select count(*) into n from get_qr_codes_with_groups() where group_id = v_tst_pre;
  perform pg_temp.lt_ok('V8 switched-on pre-entry shows on the QR page', n = 1, n::text);
  perform set_group_qr_active(v_tst_term, false);
  select count(*) into n from get_qr_codes_with_groups() where group_id = v_tst_term;
  perform pg_temp.lt_ok('V8 switched-off hand-over hidden from Admin too (Q4)', n = 0, n::text);
  perform set_group_qr_active(v_tst_term, true);
  perform pg_temp.lt_back();
  perform pg_temp.lt_act(null, null);
  select flow_type::text into v_txt from checkin_get_flow(v_tst_pre_tok);
  perform pg_temp.lt_ok('V8 switched-on pre-entry is intake only', v_txt = 'intake_only', v_txt);
  perform pg_temp.lt_back();

  -- V7: the TST ladder ------------------------------------------------------
  perform pg_temp.lt_act(v_owner, 'TST');
  v_new := add_group('ZZ Grade 4');
  select ladder_position, display_order into v_lvl, v_ord from groups where id = v_new;
  select display_order into n from groups where id = v_tst_term;
  perform pg_temp.lt_ok('V7 add group = new top level, just before hand-over', v_lvl = 4 and v_ord = n - 1,
    format('level %s order %s hand-over order %s, hand-over level %s', v_lvl, v_ord, n,
           (select ladder_position from groups where id = v_tst_term)));
  select qr_color into v_txt from groups where id = v_new;
  perform pg_temp.lt_ok('V7 add group picks a distinct colour', v_txt is not null and not exists (
    select 1 from groups where ministry_id = 'TST' and not is_archived and id <> v_new and lower(qr_color) = lower(v_txt)), v_txt);
  v_new2 := add_group('ZZ Grade 2 B', 2);
  perform pg_temp.lt_ok('V7 second class at an existing level', (select ladder_position from groups where id = v_new2) = 2
    and (select count(*) from groups where ministry_id = 'TST' and kind = 'regular' and not is_archived and ladder_position = 2) = 2);
  select display_order into v_ord from groups where id = v_new2;
  perform move_group(v_new2, 'up');
  perform pg_temp.lt_ok('V7 move up', (select display_order from groups where id = v_new2) = v_ord - 1);
  begin
    perform rename_group(v_new2, '2026 - Grade 1');
    v_err := 'renamed';
  exception when others then v_err := sqlerrm;
  end;
  perform pg_temp.lt_ok('V7 duplicate names refused', v_err <> 'renamed', v_err);
  perform set_group_level(v_new2, 3);
  perform pg_temp.lt_ok('V7 change level', (select ladder_position from groups where id = v_new2) = 3);
  perform set_group_level(v_new2, 2);

  -- Blocked while the hand-over group holds someone; archive clears it.
  r := preview_group_transition(2027);
  perform pg_temp.lt_ok('V7 preview blocked by the hand-over youth', (r ->> 'blocked')::boolean and (r ->> 'occupant_count')::int = 1, r::text);
  begin
    perform run_group_transition(2027);
    v_err := 'ran';
  exception when others then v_err := sqlerrm;
  end;
  perform pg_temp.lt_ok('V7 run refused while blocked', v_err <> 'ran', v_err);
  n := archive_terminal_members();
  perform pg_temp.lt_ok('V7 archive hand-over youths', n = 1, n::text);
  -- TST's own test rows would clash after renaming ("2026 - Grade 1" becomes
  -- "2026 - Grade 2", which the cohort-3 row is already called): the preview
  -- must say so rather than fail. Then their names are kept fixed.
  r := preview_group_transition(2027);
  perform pg_temp.lt_ok('V7 preview reports a name clash', r ->> 'error' like '%same name%', r::text);
  perform pg_temp.lt_back();
  update groups set name_pattern = null where ministry_id = 'TST';

  -- A servant on the top class (Q12 case: also serves a group that stays) and
  -- one who serves only the top class (rolls back to level 1).
  insert into profiles (ministry_id, id, full_name) select 'TST', id, 'ZZ ' || coalesce(full_name, 'gc')
    from profiles where ministry_id = 'SAY' and id = v_gc on conflict do nothing;
  insert into profiles (ministry_id, id, full_name) select 'TST', id, 'ZZ ' || coalesce(full_name, 'srv')
    from profiles where ministry_id = 'SAY' and id = v_srv on conflict do nothing;
  insert into user_roles (ministry_id, user_id, role, group_id) values
    ('TST', v_gc, 'servant', v_new), ('TST', v_gc, 'servant', v_new2), ('TST', v_srv, 'servant', v_new);
  insert into members (ministry_id, group_id, full_name, gender, assigned_servant_id) values
    ('TST', v_new, 'ZZ Top Boy', 'Male', v_srv), ('TST', v_new, 'ZZ Top Girl', 'Female', v_gc);

  perform pg_temp.lt_act(v_owner, 'TST');
  r := preview_group_transition(2027);
  perform pg_temp.lt_ok('V7 preview not blocked', not (r ->> 'blocked')::boolean and r -> 'error' is null, r::text);
  perform pg_temp.lt_ok('V7 preview lists grants dropped (Q12) and moved',
    jsonb_array_length(r -> 'grants_dropped') = 1 and jsonb_array_length(r -> 'grants_moved') = 1, r::text);
  perform pg_temp.lt_ok('V7 preview counts cleared assignments', (r ->> 'assignments_cleared_total')::int = 2, r ->> 'assignments_cleared_total');
  perform pg_temp.lt_ok('V7 preview changed nothing', (select count(*) from groups where id = v_new and not is_archived) = 1
    and (select count(*) from groups where ministry_id = 'TST' and kind = 'pre_entry' and not is_archived and id = v_tst_pre) = 1);
  r_prev := r;
  r := run_group_transition(2027);
  perform pg_temp.lt_back();
  perform pg_temp.lt_ok('V7 run: top class archived', (select is_archived from groups where id = v_new), r::text);
  perform pg_temp.lt_ok('V7 run: its youths in hand-over, assignments cleared',
    (select count(*) from members where group_id = v_tst_term and full_name like 'ZZ Top%' and assigned_servant_id is null) = 2);
  perform pg_temp.lt_ok('V7 run: hand-over renamed from the pattern (no cohort year -> "Transitioning")',
    (select name from groups where id = v_tst_term) = 'Transitioning', (select name from groups where id = v_tst_term));
  perform pg_temp.lt_ok('V7 run: Q12 grant dropped, other grant moved to new level 1',
    not exists (select 1 from user_roles where user_id = v_gc and ministry_id = 'TST' and group_id = v_tst_pre)
    and exists (select 1 from user_roles where user_id = v_srv and ministry_id = 'TST' and group_id = v_tst_pre)
    and exists (select 1 from user_roles where user_id = v_gc and ministry_id = 'TST' and group_id = v_new2));
  perform pg_temp.lt_ok('V7 run: old pre-entry is level 1 with a check-in code',
    (select kind::text || ladder_position from groups where id = v_tst_pre) = 'regular1'
    and (select flow_type::text from qr_codes where group_id = v_tst_pre) = 'check_in_and_intake');
  perform pg_temp.lt_ok('V7 run: new pre-entry, intake only, switched off, relayed colour',
    exists (select 1 from groups g join qr_codes q on q.group_id = g.id where g.ministry_id = 'TST' and g.kind = 'pre_entry'
            and not g.is_archived and g.cohort_year = 2027 and not g.qr_active and q.flow_type = 'intake_only'
            and g.qr_color = (select qr_color from groups where id = v_new)));
  perform pg_temp.lt_ok('V7 run: levels contiguous, hand-over last',
    (select count(distinct ladder_position) = max(ladder_position) from groups where ministry_id = 'TST' and kind = 'regular' and not is_archived)
    and (select ladder_position from groups where id = v_tst_term) =
        (select max(ladder_position) + 1 from groups where ministry_id = 'TST' and kind = 'regular' and not is_archived),
    (select string_agg(name || ':' || kind || ':' || ladder_position || ':' || display_order, ', ' order by display_order)
     from groups where ministry_id = 'TST' and not is_archived));
  perform pg_temp.lt_ok('V7 run: preview matched the run', r_prev - 'groups' - 'new_groups' = r - 'groups' - 'new_groups'
    and r_prev -> 'groups' = r -> 'groups' and r_prev -> 'new_groups' = r -> 'new_groups', r_prev::text);

  -- V12: two classes graduate together, per gender.
  perform pg_temp.lt_act(v_owner, 'TST');
  perform archive_terminal_members();
  select array_agg(id order by display_order) into v_ids from groups
  where ministry_id = 'TST' and kind = 'regular' and not is_archived
    and ladder_position = (select max(ladder_position) from groups where ministry_id = 'TST' and kind = 'regular' and not is_archived);
  perform pg_temp.lt_back();
  insert into members (ministry_id, group_id, full_name, gender)
  select 'TST', v_ids[1], 'ZZ G Boy ' || i, 'Male' from generate_series(1, 2) i
  union all select 'TST', v_ids[1], 'ZZ G Girl', 'Female'
  union all select 'TST', v_ids[1], 'ZZ G Unknown', null;
  perform pg_temp.lt_act(v_owner, 'TST');
  v_new := add_group('ZZ Second top class', (select ladder_position from groups where id = v_ids[1]));
  r := preview_group_transition(2028, null, null, 'by_gender');
  perform pg_temp.lt_ok('V12 per-gender preview: two hand-over groups, unknown gender listed',
    r ->> 'mode' = 'by_gender' and jsonb_array_length(r -> 'hand_over_names') = 2
    and jsonb_array_length(r -> 'unknown_gender') >= 1, r::text);
  r := preview_group_transition(2028, null, null, 'separate');
  perform pg_temp.lt_ok('V12 separate preview: one hand-over group per class',
    jsonb_array_length(r -> 'hand_over_names') = 2 and r ->> 'mode' = 'separate', r::text);
  r := run_group_transition(2028, null, array['ZZ HO Boys', 'ZZ HO Girls'], 'by_gender');
  perform pg_temp.lt_back();
  perform pg_temp.lt_ok('V12 per-gender run',
    (select count(*) from members m join groups g on g.id = m.group_id
     where g.name = 'ZZ HO Girls' and g.kind = 'terminal' and m.full_name like 'ZZ G%') = 1
    and (select count(*) from members m join groups g on g.id = m.group_id
         where g.name = 'ZZ HO Boys' and g.kind = 'terminal' and m.full_name like 'ZZ G%') = 3,
    r::text);
  perform pg_temp.lt_act(v_owner, 'TST');
  r := preview_group_transition(2029);
  perform pg_temp.lt_ok('V12 next transition blocked until every hand-over group is empty',
    (r ->> 'blocked')::boolean and (r ->> 'occupant_count')::int >= 4, r::text);
  perform archive_terminal_members();
  r := preview_group_transition(2029);
  perform pg_temp.lt_ok('V12 emptied extra hand-over group is archived at the next transition',
    r -> 'extra_hand_over_archived' ? 'ZZ HO Girls' and r -> 'error' is null, r::text);
  perform pg_temp.lt_back();

  -- Q6: moving a servant clears their assignments in the group they leave.
  perform pg_temp.lt_act(v_owner, 'SAY');
  select count(*) into n from members where group_id = v_srv_group and assigned_servant_id = v_srv;
  perform reassign_role_group((select id from user_roles where ministry_id = 'SAY' and user_id = v_srv
                               and role = 'servant' and group_id = v_srv_group), v_say_reg);
  perform pg_temp.lt_back();
  select count(*) into n2 from members where group_id = v_srv_group and assigned_servant_id = v_srv;
  perform pg_temp.lt_ok('Q6 servant move clears old assignments', v_srv_group = v_say_reg or n2 = 0,
    format('%s before, %s after', n, n2));
end
$t$;
