-- 0070_say_terminal_split.sql -- SAY ONLY, ONE-TIME (GROUP_LADDER_PLAN.md v1.3, §5).
-- Runs after 0069, once per environment, as ONE transaction, QA first:
--     begin; set local search_path to qa; \i 0070_say_terminal_split.sql; commit;
-- Undo with 0070_down_say_terminal_split.sql.
--
-- Splits SAY's "2004 & older" (level 5) by birth year:
--   2004, 2005                        -> stays, renamed "2004 - Yr 5"      (O1)
--   2003, no birth date, 2024 or later -> new "2003 - Yr 6" (level 6)     (O1 option A)
--   2002 or earlier                    -> "2002 - Transitioning" (hidden hand-over group, from 0069)
-- Codes (D13): "2004 - Yr 5" keeps the existing "2004 & older" QR code and
-- token, and "2003 - Yr 6" and "2002 - Transitioning" share it, so the
-- poster already up keeps working for all three.
-- Grants (O2 option E): Kristeen Eshak and Mike Elgabalawi become
-- Coordinators (and Servants) of both Yr 5 and Yr 6, keeping their
-- assignments; every Read-Only grant on Yr 5 is extended to Yr 6.
-- Any other assignment whose servant doesn't serve the youth's new group is
-- cleared (listed in the report); the hand-over group has no assignments.
--
-- SAFETY: stops unless the group looks exactly as expected and the counts
-- per destination equal the ones measured at the rehearsal (v_expect below,
-- filled in after the rehearsal; a youth who registers in between is
-- noticed, not mis-filed). A rehearsal sets `set local ladder.split_rehearsal = 'on'`
-- to skip only that count comparison. Attendance and outreach belong to the
-- person and are never touched. Self-checks at the end undo everything on
-- any surprise. A copy of every changed row goes to <schema>_premm_backup.

do $$
declare
  -- Measured at the rehearsal, per environment: {"yr5": n, "yr6": n, "handover": n}.
  -- QA measured 30 Sep 2026 (rehearsal). prod: fill in from the prod rehearsal (P1).
  v_expect jsonb := '{"qa": {"yr5": 152, "yr6": 178, "handover": 63}, "prod": null}'::jsonb;
  v_rehearsal boolean := coalesce(current_setting('ladder.split_rehearsal', true), '') = 'on';
  v_kristeen constant uuid := '907cf923-f0e9-4980-af44-cd889dae6f84';
  v_mike     constant uuid := '0813ff33-dd76-40b0-b976-0b6ee3e19b21';
  v_bk text := current_schema() || '_premm_backup';
  g5 groups%rowtype;
  t groups%rowtype;
  v_yr6 uuid;
  v_counts jsonb;
  v_other text;
  v_members_before bigint;
  v_att_before bigint;
  v_out_before bigint;
  v_cleared jsonb;
  v_grants jsonb := '[]';
  v_bad text;
  v_served uuid[];
  u uuid;
begin
  -- 1. Checks ---------------------------------------------------------------
  if current_schema() not in ('qa', 'prod') then
    raise exception 'Run with search_path set to qa or prod (got %)', current_schema();
  end if;
  if not exists (select 1 from information_schema.columns
                 where table_schema = current_schema() and table_name = 'groups' and column_name = 'kind') then
    raise exception '0069 is not applied';
  end if;
  perform 1 from groups where ministry_id = 'SAY' and not is_archived for update;
  select * into g5 from groups
  where ministry_id = 'SAY' and name = '2004 & older' and kind = 'regular' and not is_archived
    and ladder_position = 5 and cohort_year = 2004;
  if g5.id is null then raise exception 'SAY "2004 & older" (level 5, cohort 2004) not found -- already split?'; end if;
  if g5.check_in_code_group_id is not null then raise exception '"2004 & older" already uses another group''s code'; end if;
  if (select max(ladder_position) from groups where ministry_id = 'SAY' and kind = 'regular' and not is_archived) <> 5 then
    raise exception 'Expected "2004 & older" to be the top level';
  end if;
  if (select count(*) from groups where ministry_id = 'SAY' and kind = 'regular' and not is_archived and ladder_position = 5) <> 1 then
    raise exception 'Expected "2004 & older" to be the only group at level 5';
  end if;
  select * into t from groups
  where ministry_id = 'SAY' and kind = 'terminal' and not is_archived and name = '2002 - Transitioning';
  if t.id is null then raise exception 'SAY hand-over group "2002 - Transitioning" not found'; end if;
  if (select count(*) from groups where ministry_id = 'SAY' and kind = 'terminal' and not is_archived) <> 1 then
    raise exception 'Expected exactly one SAY hand-over group';
  end if;
  if exists (select 1 from members where group_id = t.id) then raise exception 'The hand-over group is not empty'; end if;
  if exists (select 1 from groups where ministry_id = 'SAY' and not is_archived
             and lower(name) in ('2004 - yr 5', '2003 - yr 6')) then
    raise exception 'A group called "2004 - Yr 5" or "2003 - Yr 6" already exists';
  end if;
  if (select count(*) from qr_codes where group_id = g5.id) <> 1 then
    raise exception '"2004 & older" should have exactly one QR code';
  end if;

  -- Every active youth must fall in one of the three buckets.
  select string_agg(distinct extract(year from date_of_birth)::text, ', ') into v_other
  from members where group_id = g5.id and status = 'active'
    and extract(year from date_of_birth) between 2006 and 2023;
  if v_other is not null then raise exception 'Youths born in % don''t fit the split rules', v_other; end if;

  select jsonb_build_object(
    'yr5', count(*) filter (where extract(year from date_of_birth) in (2004, 2005)),
    'yr6', count(*) filter (where date_of_birth is null or extract(year from date_of_birth) = 2003
                                  or extract(year from date_of_birth) >= 2024),
    'handover', count(*) filter (where extract(year from date_of_birth) <= 2002))
  into v_counts
  from members where group_id = g5.id and status = 'active';
  raise notice 'Split counts in %: %', current_schema(), v_counts;
  if not v_rehearsal then
    if v_expect -> current_schema() is null or jsonb_typeof(v_expect -> current_schema()) = 'null' then
      raise exception 'Fill in v_expect for % from the rehearsal first (measured now: %)', current_schema(), v_counts;
    end if;
    if v_expect -> current_schema() <> v_counts then
      raise exception 'Counts changed since the rehearsal: expected %, now %', v_expect -> current_schema(), v_counts;
    end if;
  end if;

  select count(*) into v_members_before from members where ministry_id = 'SAY';
  select count(*) into v_att_before from attendance_records where ministry_id = 'SAY';
  select count(*) into v_out_before from outreach_entries where ministry_id = 'SAY';

  -- 2. Backup ---------------------------------------------------------------
  execute format('create schema if not exists %I', v_bk);
  execute format('revoke all on schema %I from public, anon, authenticated', v_bk);
  execute format('drop table if exists %I.say_split_0070_members, %I.say_split_0070_roles, %I.say_split_0070_groups, %I.say_split_0070_qr',
                 v_bk, v_bk, v_bk, v_bk);
  execute format('create table %I.say_split_0070_members as
                    select id, group_id, assigned_servant_id, is_new_assignment from members where group_id = $1', v_bk) using g5.id;
  execute format('create table %I.say_split_0070_roles as select * from user_roles where group_id = $1', v_bk) using g5.id;
  -- kind is kept as text, so the backup never blocks undoing 0069 (which drops its type).
  execute format('create table %I.say_split_0070_groups as
                    select id, name, name_pattern, kind::text as kind, display_order, ladder_position, check_in_code_group_id
                    from groups where id in ($1, $2)', v_bk) using g5.id, t.id;
  execute format('create table %I.say_split_0070_qr as select * from qr_codes where group_id in ($1, $2)', v_bk) using g5.id, t.id;

  -- 3. "2004 & older" becomes "2004 - Yr 5" (same row, colour, grants, code).
  update groups set name = '2004 - Yr 5', name_pattern = '{cohort_year} - Yr {level}' where id = g5.id;
  update qr_codes set label = '2004 - Yr 5' where group_id = g5.id;

  -- 4. New "2003 - Yr 6" sharing Yr 5's code; the hand-over group shares it too.
  insert into groups (ministry_id, kind, cohort_year, ladder_position, name, display_order, qr_color, name_pattern,
                      check_in_code_group_id)
  values ('SAY', 'regular', 2003, 6, '2003 - Yr 6', g5.display_order, pick_group_color('SAY'),
          '{cohort_year} - Yr {level}', g5.id)
  returning id into v_yr6;
  delete from qr_codes where group_id = t.id;
  update groups set check_in_code_group_id = g5.id, qr_active = true where id = t.id;
  perform normalize_group_levels('SAY');
  perform tidy_group_order('SAY');

  -- 5. Youths by birth year (active only; archived youths stay where they are).
  update members set group_id = v_yr6
  where group_id = g5.id and status = 'active'
    and (date_of_birth is null or extract(year from date_of_birth) = 2003 or extract(year from date_of_birth) >= 2024);
  update members set group_id = t.id
  where group_id = g5.id and status = 'active' and extract(year from date_of_birth) <= 2002;

  -- 6. Grants (O2 option E). The auto-servant setting adds the Servant
  --    grants; they're also added explicitly in case it's switched off.
  foreach u in array array[v_kristeen, v_mike] loop
    if exists (select 1 from profiles where ministry_id = 'SAY' and id = u) then
      insert into user_roles (ministry_id, user_id, role, group_id) values
        ('SAY', u, 'sub_coordinator', g5.id), ('SAY', u, 'sub_coordinator', v_yr6),
        ('SAY', u, 'servant', g5.id), ('SAY', u, 'servant', v_yr6)
      on conflict do nothing;
      v_grants := v_grants || jsonb_build_object('person', (select full_name from profiles where ministry_id = 'SAY' and id = u),
                                                 'grants', 'Coordinator + Servant on Yr 5 and Yr 6');
    else
      raise notice 'No SAY profile for % in % -- skipped', u, current_schema();
    end if;
  end loop;
  insert into user_roles (ministry_id, user_id, role, group_id)
  select 'SAY', user_id, 'read_only', v_yr6 from user_roles where group_id = g5.id and role = 'read_only'
  on conflict do nothing;
  v_grants := v_grants || coalesce((select jsonb_agg(jsonb_build_object('person', p.full_name, 'grants', 'Read-Only on Yr 6'))
                                    from user_roles ur join profiles p on p.ministry_id = 'SAY' and p.id = ur.user_id
                                    where ur.group_id = v_yr6 and ur.role = 'read_only'), '[]'::jsonb);

  -- 7. Assignments that no longer fit are cleared (listed in the report).
  select coalesce(jsonb_agg(jsonb_build_object('youth', m.full_name, 'group', g.name, 'servant', p.full_name)
                            order by g.name, m.full_name), '[]'::jsonb)
    into v_cleared
  from members m join groups g on g.id = m.group_id
  left join profiles p on p.ministry_id = 'SAY' and p.id = m.assigned_servant_id
  where m.group_id in (v_yr6, t.id) and m.assigned_servant_id is not null
    and (m.group_id = t.id or not exists (select 1 from user_roles ur where ur.group_id = m.group_id
                                          and ur.user_id = m.assigned_servant_id and ur.role = 'servant'));
  update members m set assigned_servant_id = null, is_new_assignment = false
  where m.group_id in (v_yr6, t.id) and m.assigned_servant_id is not null
    and (m.group_id = t.id or not exists (select 1 from user_roles ur where ur.group_id = m.group_id
                                          and ur.user_id = m.assigned_servant_id and ur.role = 'servant'));

  insert into audit_log (ministry_id, user_id, action_type, details)
  values ('SAY', auth.uid(), 'GROUP_TRANSITION_RUN', jsonb_build_object(
    'model', 'say_split_0070', 'one_time_split', '"2004 & older" -> "2004 - Yr 5", "2003 - Yr 6", "2002 - Transitioning"',
    'counts', v_counts, 'grants_added', v_grants, 'assignments_cleared', jsonb_array_length(v_cleared)));

  -- 8. Self-checks (any failure undoes everything) ----------------------------
  if (select count(*) from members where ministry_id = 'SAY') <> v_members_before
     or (select count(*) from attendance_records where ministry_id = 'SAY') <> v_att_before
     or (select count(*) from outreach_entries where ministry_id = 'SAY') <> v_out_before then
    raise exception 'Youth, attendance or outreach counts changed';
  end if;
  if (select count(*) from members where group_id = g5.id and status = 'active') <> (v_counts ->> 'yr5')::int
     or (select count(*) from members where group_id = v_yr6 and status = 'active') <> (v_counts ->> 'yr6')::int
     or (select count(*) from members where group_id = t.id and status = 'active') <> (v_counts ->> 'handover')::int then
    raise exception 'Per-group counts differ from %', v_counts;
  end if;
  select string_agg(m.full_name, ', ') into v_bad
  from members m where m.group_id in (g5.id, v_yr6, t.id) and m.assigned_servant_id is not null
    and not exists (select 1 from user_roles ur where ur.group_id = m.group_id
                    and ur.user_id = m.assigned_servant_id and ur.role = 'servant');
  if v_bad is not null then raise exception 'Assigned to someone who doesn''t serve their group: %', v_bad; end if;
  if exists (select 1 from user_roles where group_id = t.id) then raise exception 'The hand-over group has grants'; end if;
  v_served := checkin_served_groups('SAY', g5.id);
  if not (v_served @> array[g5.id, v_yr6, t.id] and cardinality(v_served) = 3) then
    raise exception 'The shared check-in code does not serve exactly Yr 5, Yr 6 and the hand-over group';
  end if;
  if (select string_agg(name, ' | ' order by display_order) from groups where ministry_id = 'SAY' and not is_archived)
     not like '%2005 - Yr 4 | 2004 - Yr 5 | 2003 - Yr 6 | 2002 - Transitioning' then
    raise exception 'Unexpected order: %',
      (select string_agg(name, ' | ' order by display_order) from groups where ministry_id = 'SAY' and not is_archived);
  end if;
  if (select ladder_position from groups where id = t.id) <> 7 then raise exception 'Hand-over group should be at level 7'; end if;

  raise notice 'Split done in %: % ; grants %; assignments cleared %', current_schema(), v_counts, v_grants, v_cleared;
end
$$;
