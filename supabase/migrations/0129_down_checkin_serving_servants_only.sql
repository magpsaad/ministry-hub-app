-- 0129_down_checkin_serving_servants_only.sql -- undoes 0129: the Servants
-- check-in offers every profile of the ministry again.
--     begin; set local search_path to qa; \i 0129_down_checkin_serving_servants_only.sql; commit;

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
       ' and p.deactivated_at is null and exists (select 1 from user_roles r where r.ministry_id = v_m and r.user_id = p.id)',
       ''),
      ('checkin_get_servant(uuid, uuid, text)',
       ' and deactivated_at is null and exists (select 1 from user_roles r where r.ministry_id = v_m and r.user_id = p_id);',
       ';'),
      ('checkin_mark_servant_attendance(uuid, uuid)',
       ' and deactivated_at is null) or not exists (select 1 from user_roles r where r.ministry_id = v_m and r.user_id = p_servant_id) then',
       ') then')
    ) t(fn, a, b)
  loop
    v := pg_get_functiondef(format('%I.%s', s, r.fn)::regprocedure);
    if position(r.a in v) = 0 then
      raise exception '% has changed; restore it by hand', r.fn;
    end if;
    execute replace(v, r.a, r.b);
  end loop;
end
$$;
