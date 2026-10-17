-- 0121_no_access_here.sql -- SOMEONE WHO SERVES IN ANOTHER MINISTRY ISN'T
-- SIGNED UP HERE BY ACCIDENT (owner-requested 17 Oct 2026).
-- An HSY servant whose Google sign-in failed was sent to SAY's address,
-- signed in there, got SAY's registration form and submitted it -- SAY's
-- Admins saw her waiting for approval. Ministries must not learn about each
-- other, so:
-- * my_access_here(): for the signed-in person only -- whether they have a
--   role here, a registration waiting here, and whether they serve (or have
--   registered) in ANY other ministry. Says nothing about which one.
--   The front door (proxy) sends someone with nothing here who serves
--   elsewhere to /no-access instead of /register; registering here takes a
--   deliberate "I want to join" there. No profile is made here until then.
-- Run once per environment, QA first:
--     begin; set local search_path to qa; \i 0121_no_access_here.sql; commit;
-- Undo with 0121_down_no_access_here.sql. Writes no audit entries.

do $$
begin
  if current_schema() not in ('qa', 'prod') then
    raise exception 'Run with search_path set to qa or prod (got %)', current_schema();
  end if;
end
$$;

create or replace function my_access_here()
returns table(role_here boolean, pending_here boolean, elsewhere boolean)
language sql stable security definer as $$
  with me as (select auth.uid() as uid, current_ministry_id() as m)
  select
    exists (select 1 from user_roles r where r.user_id = me.uid and r.ministry_id = me.m),
    exists (select 1 from pending_servants p
            where p.submitted_by_profile_id = me.uid and p.ministry_id = me.m and p.resulting_profile_id is null),
    exists (select 1 from user_roles r where r.user_id = me.uid and r.ministry_id <> me.m)
      or exists (select 1 from pending_servants p
                 where p.submitted_by_profile_id = me.uid and p.ministry_id <> me.m and p.resulting_profile_id is null)
  from me
  where me.uid is not null and me.m is not null;
$$;

do $$
declare s text := current_schema();
begin
  execute format('alter function my_access_here() set search_path = %I, public, pg_temp', s);
  revoke all on function my_access_here() from public, anon;
  grant execute on function my_access_here() to authenticated;
end
$$;
