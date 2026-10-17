-- 0120_new_ministry_audit_types.sql -- A NEW MINISTRY GETS ONLY THE ACTION
-- TYPES STILL RECORDED (owner-requested 17 Oct 2026, follows 0119).
-- create_ministry() filled audit_config with every audit_action_type ever
-- defined, so the 18 types no longer recorded (0119) would come back in a
-- new ministry's Audit Logs "Action Type" filter. It now copies the action
-- types (and descriptions) of the ministry it copies from (SAY by default),
-- whose old types the owner's clean-up removed.
-- Run once per environment, QA first:
--     begin; set local search_path to qa; \i 0120_new_ministry_audit_types.sql; commit;
-- Undo with 0120_down_new_ministry_audit_types.sql. Writes no audit entries.

do $$
declare v text; a text; b text;
begin
  if current_schema() not in ('qa', 'prod') then
    raise exception 'Run with search_path set to qa or prod (got %)', current_schema();
  end if;
  v := pg_get_functiondef(format('%I.create_ministry(text, text, text[], text[], text, jsonb, text, text)', current_schema())::regprocedure);
  a := E'  insert into audit_config (ministry_id, action_type, enabled, description)\n'
    || E'  select p_id, t, true,\n'
    || E'         (select c.description from audit_config c where c.ministry_id = coalesce(p_copy_from, ''SAY'') and c.action_type = t)\n'
    || E'  from unnest(enum_range(null::audit_action_type)) t;\n';
  b := E'  -- Only the action types still recorded (0120): the copied-from ministry''s.\n'
    || E'  insert into audit_config (ministry_id, action_type, enabled, description)\n'
    || E'  select p_id, c.action_type, true, c.description\n'
    || E'  from audit_config c where c.ministry_id = coalesce(p_copy_from, ''SAY'');\n';
  if position(a in v) = 0 then
    raise exception 'create_ministry has changed; patch it by hand';
  end if;
  execute replace(v, a, b);
end
$$;
