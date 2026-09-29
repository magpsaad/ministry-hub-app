-- Project B dress rehearsal, part 3 of 3 (after 0064 has run in the same
-- transaction). Compares what the same users see now, and reports through a
-- deliberate exception so the whole transaction is rolled back.

select pg_temp.mm_capture('post_no_header', null);   -- the currently deployed app
select pg_temp.mm_capture('post_say', 'SAY');         -- the new app on SAY's address
select pg_temp.mm_capture('post_unknown', 'ZZZ');     -- a made-up ministry code

insert into mm_checkin
select 'post', q.check_in_token,
       case when q.group_id is null then (select count(*) from checkin_list_servants(q.check_in_token))
            when q.flow_type = 'check_in_and_intake' then (select count(*) from checkin_list_members(q.check_in_token))
            else -2 end
from qr_codes q;

do $chk$
declare
  v_diff_nohdr text; v_diff_say text; v_leak text; v_checkin text; v_users text; r text;
begin
  select string_agg(a.label || '/' || a.tbl || ' ' || a.cnt || '->' || b.cnt, '; ') into v_diff_nohdr
  from mm_fp a join mm_fp b on b.label = a.label and b.tbl = a.tbl and b.phase = 'post_no_header'
  where a.phase = 'pre' and (a.cnt, a.h) is distinct from (b.cnt, b.h);

  select string_agg(a.label || '/' || a.tbl || ' ' || a.cnt || '->' || b.cnt, '; ') into v_diff_say
  from mm_fp a join mm_fp b on b.label = a.label and b.tbl = a.tbl and b.phase = 'post_say'
  where a.phase = 'pre' and (a.cnt, a.h) is distinct from (b.cnt, b.h);

  -- With an unknown ministry code nobody may see any ministry data at all.
  select string_agg(label || '/' || tbl || '=' || cnt, '; ') into v_leak
  from mm_fp where phase = 'post_unknown' and tbl <> 'app_releases' and cnt > 0;

  select string_agg(a.token::text || ' ' || a.n || '->' || b.n, '; ') into v_checkin
  from mm_checkin a join mm_checkin b on b.token = a.token and b.phase = 'post'
  where a.phase = 'pre' and a.n is distinct from b.n;

  select string_agg(label || '=' || coalesce(left(uid::text, 8), 'none'), ', ') into v_users from mm_users;

  r := 'users[' || v_users || ']'
    || ' | cells compared per phase=' || (select count(*) from mm_fp where phase = 'pre')
    || ' | DIFF pre vs no-header: ' || coalesce(v_diff_nohdr, 'none')
    || ' | DIFF pre vs SAY header: ' || coalesce(v_diff_say, 'none')
    || ' | LEAKS with unknown code: ' || coalesce(v_leak, 'none')
    || ' | check-in list changes: ' || coalesce(v_checkin, 'none')
    || ' | policies=' || (select count(*) from pg_policies where schemaname = current_schema())
    || ' | definer fns without pinned search_path=' || (select count(*) from pg_proc
         where pronamespace = current_schema()::regnamespace and prosecdef and proconfig is null)
    || ' | rows now SAY: members=' || (select count(*) from members where ministry_id = 'SAY')
    || ' attendance=' || (select count(*) from attendance_records where ministry_id = 'SAY')
    || ' profiles=' || (select count(*) from profiles where ministry_id = 'SAY');
  raise exception 'REHEARSAL_RESULT %', r;
end
$chk$;
