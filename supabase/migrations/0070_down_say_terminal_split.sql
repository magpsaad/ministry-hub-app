-- 0070_down_say_terminal_split.sql -- UNDO of 0070_say_terminal_split.sql.
--     begin; set local search_path to qa; \i 0070_down_say_terminal_split.sql; commit;
-- Puts every youth of the split back in "2004 & older" with their old
-- assignment, removes the grants the split added and "2003 - Yr 6", gives
-- "2002 - Transitioning" back its own code (same token as before) and
-- renames "2004 - Yr 5" back. Attendance and outreach were never touched.
-- Refuses if a Group Transition has run since the split.

do $$
declare
  v_bk text := current_schema() || '_premm_backup';
  g5 uuid;
  t uuid;
  v_yr6 uuid;
  v_split_at timestamptz;
begin
  if current_schema() not in ('qa', 'prod') then
    raise exception 'Run with search_path set to qa or prod (got %)', current_schema();
  end if;
  if to_regclass(v_bk || '.say_split_0070_members') is null then raise exception 'No 0070 backup found'; end if;
  select occurred_at into v_split_at from audit_log
  where ministry_id = 'SAY' and action_type = 'GROUP_TRANSITION_RUN' and details ->> 'model' = 'say_split_0070'
  order by occurred_at desc limit 1;
  if v_split_at is null then raise exception 'The split is not recorded as run'; end if;
  if exists (select 1 from audit_log where ministry_id = 'SAY' and action_type = 'GROUP_TRANSITION_RUN'
             and occurred_at > v_split_at and details ->> 'model' = 'group_ladder_0069') then
    raise exception 'A Group Transition has run since the split -- this undo no longer applies';
  end if;

  execute format('select id from %I.say_split_0070_groups where kind = ''regular''', v_bk) into g5;
  execute format('select id from %I.say_split_0070_groups where kind = ''terminal''', v_bk) into t;
  select id into v_yr6 from groups where ministry_id = 'SAY' and name = '2003 - Yr 6' and check_in_code_group_id = g5;
  if g5 is null or t is null or v_yr6 is null then raise exception 'Split groups not found as expected'; end if;
  perform 1 from groups where ministry_id = 'SAY' and not is_archived for update;

  -- Youths back, with their old assignments.
  execute format('update members m set group_id = b.group_id, assigned_servant_id = b.assigned_servant_id,
                         is_new_assignment = b.is_new_assignment
                  from %I.say_split_0070_members b where b.id = m.id', v_bk);
  if exists (select 1 from members where group_id in (v_yr6, t)) then
    raise exception 'Youths in "2003 - Yr 6" or the hand-over group that were not part of the split -- move them first';
  end if;

  -- Grants: everything on Yr 6 goes; Yr 5 goes back to the copy.
  delete from user_roles where group_id = v_yr6;
  execute format('delete from user_roles ur where ur.group_id = $1
                  and not exists (select 1 from %I.say_split_0070_roles b where b.id = ur.id)', v_bk) using g5;

  -- Groups and codes.
  delete from groups where id = v_yr6;
  execute format('update groups g set name = b.name, name_pattern = b.name_pattern from %I.say_split_0070_groups b
                  where b.id = g.id and g.id = $1', v_bk) using g5;
  update groups set check_in_code_group_id = null where id = t;
  execute format('insert into qr_codes select * from %I.say_split_0070_qr b where b.group_id = $1
                  and not exists (select 1 from qr_codes q where q.id = b.id)', v_bk) using t;
  execute format('update qr_codes q set label = b.label from %I.say_split_0070_qr b where b.id = q.id', v_bk);
  perform normalize_group_levels('SAY');
  perform tidy_group_order('SAY');

  update audit_log set details = details || jsonb_build_object('model', 'say_split_0070_undone', 'undone_at', now())
  where ministry_id = 'SAY' and action_type = 'GROUP_TRANSITION_RUN' and details ->> 'model' = 'say_split_0070';

  if (select name from groups where id = g5) <> '2004 & older'
     or (select ladder_position from groups where id = t) <> 6
     or (select count(*) from qr_codes where group_id = t) <> 1 then
    raise exception 'Undo self-check failed';
  end if;
end
$$;
