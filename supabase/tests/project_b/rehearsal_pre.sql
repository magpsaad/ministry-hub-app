-- Project B dress rehearsal, part 1 of 3 (run inside ONE transaction that is
-- rolled back; see rehearsal_post.sql). Captures what a sample of real users
-- can see BEFORE the migration, through the same security rules the app uses.

create temp table mm_users (label text, uid uuid) on commit drop;
create temp table mm_fp (phase text, label text, tbl text, cnt bigint, h text) on commit drop;
create temp table mm_checkin (phase text, token uuid, n bigint) on commit drop;

-- One person per kind of access, plus a signed-out visitor (uid null).
insert into mm_users
select 'admin', (select user_id from user_roles where role = 'admin' order by user_id limit 1)
union all select 'general_coordinator', (select user_id from user_roles where role = 'general_coordinator' order by user_id limit 1)
union all select 'sub_coordinator', (select user_id from user_roles where role = 'sub_coordinator' order by user_id limit 1)
union all select 'servant_in_group', (select ur.user_id from user_roles ur where ur.role = 'servant' and ur.group_id is not null
            and not exists (select 1 from user_roles x where x.user_id = ur.user_id and x.role <> 'servant') order by ur.user_id limit 1)
union all select 'read_only', (select user_id from user_roles where role = 'read_only' order by user_id limit 1)
union all select 'unassigned_servant', (select ur.user_id from user_roles ur where ur.role = 'servant' and ur.group_id is null
            and not exists (select 1 from user_roles x where x.user_id = ur.user_id and x.role <> 'servant') order by ur.user_id limit 1)
union all select 'signed_in_no_role', (select p.id from profiles p where not exists (select 1 from user_roles x where x.user_id = p.id) order by p.id limit 1)
union all select 'signed_out', null;

create function pg_temp.mm_capture(p_phase text, p_header text) returns void language plpgsql as $f$
declare
  u record;
  t record;
  v_cnt bigint; v_h text;
  a_tbl text[]; a_cnt bigint[]; a_h text[];
begin
  for u in select * from mm_users loop
    a_tbl := '{}'; a_cnt := '{}'; a_h := '{}';
    perform set_config('request.headers', coalesce(json_build_object('x-ministry-id', p_header)::text, ''), true);
    if u.uid is null then
      perform set_config('request.jwt.claims', json_build_object('role', 'anon')::text, true);
      perform set_config('role', 'anon', true);
    else
      perform set_config('request.jwt.claims', json_build_object('sub', u.uid, 'role', 'authenticated')::text, true);
      perform set_config('role', 'authenticated', true);
    end if;
    for t in select * from (values
        ('members', 'id'), ('attendance_records', 'id'), ('outreach_entries', 'id'), ('groups', 'id'),
        ('profiles', 'id'), ('user_roles', 'id'), ('universities', 'id'), ('verses', 'id'),
        ('service_calendar_events', 'id'), ('audit_log', 'id'), ('pending_servants', 'id'),
        ('pending_servant_attendance', 'id'), ('qr_codes', 'id'), ('holiday_rules', 'id'),
        ('app_settings', '''x'''), ('audit_config', 'action_type'), ('actions_needed_config', 'proximity'),
        ('app_releases', 'id')) as x(tbl, k)
    loop
      begin
        execute format('select count(*), md5(coalesce(string_agg((%s)::text, '','' order by (%s)::text), '''')) from %I', t.k, t.k, t.tbl)
          into v_cnt, v_h;
      exception when insufficient_privilege then
        v_cnt := -1; v_h := 'denied';
      end;
      a_tbl := a_tbl || t.tbl; a_cnt := a_cnt || v_cnt; a_h := a_h || v_h;
    end loop;
    perform set_config('role', 'none', true);
    perform set_config('request.jwt.claims', '', true);
    insert into mm_fp select p_phase, u.label, x.tbl, x.cnt, x.h from unnest(a_tbl, a_cnt, a_h) as x(tbl, cnt, h);
  end loop;
  perform set_config('request.headers', '', true);
end
$f$;

select pg_temp.mm_capture('pre', null);

-- Check-in lists for every QR code, as a signed-out phone would see them.
insert into mm_checkin
select 'pre', q.check_in_token,
       case when q.group_id is null then (select count(*) from checkin_list_servants(q.check_in_token))
            when q.flow_type = 'check_in_and_intake' then (select count(*) from checkin_list_members(q.check_in_token))
            else -2 end
from qr_codes q;
