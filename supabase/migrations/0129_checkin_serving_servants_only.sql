-- 0129_checkin_serving_servants_only.sql -- THE SERVANTS CHECK-IN LISTS ONLY
-- PEOPLE WHO SERVE HERE (owner-requested 23 Oct 2026). The Servants QR's
-- search offered every profile of the ministry -- anyone who had ever signed
-- in, deactivated people included -- so the owner's check-ins went to his
-- second Google account ("Mag S.", no role) instead of "Maged S.", and a
-- phone's one-tap "Check in as ..." kept choosing it.
-- Now a profile counts only if it holds a role in this ministry and isn't
-- deactivated, in all three places:
-- * checkin_search_servants(): the list.
-- * checkin_get_servant(): the phone's remembered "Check in as ...".
-- * checkin_mark_servant_attendance(): the check-in itself.
-- Registrations still waiting for approval are listed as before.
-- Run once per environment, QA first:
--     begin; set local search_path to qa; \i 0129_checkin_serving_servants_only.sql; commit;
-- Undo with 0129_down_checkin_serving_servants_only.sql. Writes no audit entries.

do $$
declare
  s text := current_schema();
  v text;
  r record;
begin
  if s not in ('qa', 'prod') then
    raise exception 'Run with search_path set to qa or prod (got %)', s;
  end if;
  for r in
    select * from (values
      ('checkin_search_servants(uuid, text)',
       'select p.id as pid, p.full_name as fname, ''servant''::text as pkind from profiles p where p.ministry_id = v_m',
       'select p.id as pid, p.full_name as fname, ''servant''::text as pkind from profiles p where p.ministry_id = v_m'
         || ' and p.deactivated_at is null and exists (select 1 from user_roles r where r.ministry_id = v_m and r.user_id = p.id)'),
      ('checkin_get_servant(uuid, uuid, text)',
       'select full_name into v_name from profiles where id = p_id and ministry_id = v_m;',
       'select full_name into v_name from profiles where id = p_id and ministry_id = v_m and deactivated_at is null'
         || ' and exists (select 1 from user_roles r where r.ministry_id = v_m and r.user_id = p_id);'),
      ('checkin_mark_servant_attendance(uuid, uuid)',
       'if not exists (select 1 from profiles where id = p_servant_id and ministry_id = v_m) then',
       'if not exists (select 1 from profiles where id = p_servant_id and ministry_id = v_m and deactivated_at is null)'
         || ' or not exists (select 1 from user_roles r where r.ministry_id = v_m and r.user_id = p_servant_id) then')
    ) t(fn, a, b)
  loop
    v := pg_get_functiondef(format('%I.%s', s, r.fn)::regprocedure);
    if (length(v) - length(replace(v, r.a, ''))) / length(r.a) <> 1 then
      raise exception '% has changed; patch it by hand', r.fn;
    end if;
    execute replace(v, r.a, r.b);
  end loop;
end
$$;
