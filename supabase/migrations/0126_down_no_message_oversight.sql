-- 0126_down_no_message_oversight.sql -- undoes 0126 (needs 0127 undone
-- first: message_oversees reads app_settings.message_oversight).
--     begin; set local search_path to qa; \i 0126_down_no_message_oversight.sql; commit;

do $$
begin
  if current_schema() not in ('qa', 'prod') then
    raise exception 'Run with search_path set to qa or prod (got %)', current_schema();
  end if;
end
$$;

create or replace function message_oversees(p_ministry text, p_user uuid default auth.uid())
returns boolean language sql stable security definer as $$
  select coalesce((select case s.message_oversight
                            when 'gc' then exists (select 1 from user_roles ur where ur.ministry_id = p_ministry and ur.user_id = p_user and ur.role = 'general_coordinator')
                            when 'gc_admin' then exists (select 1 from user_roles ur where ur.ministry_id = p_ministry and ur.user_id = p_user and ur.role in ('general_coordinator', 'admin'))
                            else false end
                   from app_settings s where s.ministry_id = p_ministry), false)
     and aal2_ok(p_user)
$$;

do $$
declare
  s text := current_schema();
  v text;
  r record;
begin
  execute format('alter function message_oversees(text, uuid) set search_path = %I, public, pg_temp', s);
  for r in
    select * from (values
      ('get_conversation(uuid)',
       'if not v_member then',
       'if not v_member and not message_oversees(c.ministry_id, v_uid) then'),
      ('my_conversations(text)',
       'if p_scope = ''all'' then',
       'if p_scope = ''all'' and not message_oversees(v_m, v_uid) then'),
      ('my_conversations(text)',
       'where c.ministry_id = v_m and me.user_id is not null',
       'where c.ministry_id = v_m and (me.user_id is not null or p_scope = ''all'')'),
      ('reaction_ministry(text, uuid, uuid, boolean)',
       'select message_is_member(c.id, p_uid)',
       'select message_is_member(c.id, p_uid) or (not p_write and message_oversees(c.ministry_id, p_uid))')
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
