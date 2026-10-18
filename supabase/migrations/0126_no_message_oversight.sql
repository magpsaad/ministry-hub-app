-- 0126_no_message_oversight.sql -- NOBODY READS CONVERSATIONS THEY AREN'T IN
-- (owner-requested 18 Oct 2026). The "Can read all messages" Ministry
-- Setting (0102/0103: General Coordinators, or GCs and System Admins) is
-- removed completely -- it was "No one" in every ministry. Only the people
-- in a conversation can read it, react to it or open it.
-- * get_conversation(): members only.
-- * my_conversations(): the people's own conversations only ('all' refused).
-- * reaction_ministry(): message reactions for members only.
-- * message_oversees(): dropped.
-- The setting's column goes in 0127, once the app no longer reads it.
-- Run once per environment, QA first:
--     begin; set local search_path to qa; \i 0126_no_message_oversight.sql; commit;
-- Undo with 0126_down_no_message_oversight.sql. Writes no audit entries.

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
      ('get_conversation(uuid)',
       'if not v_member and not message_oversees(c.ministry_id, v_uid) then',
       'if not v_member then'),
      ('my_conversations(text)',
       'if p_scope = ''all'' and not message_oversees(v_m, v_uid) then',
       'if p_scope = ''all'' then'),
      ('my_conversations(text)',
       'where c.ministry_id = v_m and (me.user_id is not null or p_scope = ''all'')',
       'where c.ministry_id = v_m and me.user_id is not null'),
      ('reaction_ministry(text, uuid, uuid, boolean)',
       'select message_is_member(c.id, p_uid) or (not p_write and message_oversees(c.ministry_id, p_uid))',
       'select message_is_member(c.id, p_uid)')
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

drop function message_oversees(text, uuid);
