-- 0069_group_ladder.sql -- GROUP LADDER REDESIGN (GROUP_LADDER_PLAN.md v1.3, §4).
-- Run once per environment, as ONE transaction, QA first:
--     begin; set local search_path to qa; \i 0069_group_ladder.sql; commit;
-- Undo with 0069_down_group_ladder.sql (only before 0070 and before any
-- transition has run under the new model).
--
-- WHAT IT DOES
-- * groups get an explicit kind: pre_entry (hidden intake group, level 0),
--   regular (levels 1..N; several groups may share a level) and terminal
--   (the hidden hand-over group, stored at level N+1). "Terminal = highest
--   number" is gone. Each ministry gets one empty hand-over group now.
-- * Display order is tidied (pre-entry first, hand-over last) and can be
--   changed with move_group(). Level and display order are separate.
-- * Per-group yearly name pattern ({cohort_year}, {level}, {label}), a
--   "QR code active" switch for the hidden groups (D5), shared check-in
--   codes (D13), automatic distinct QR colours (A8).
-- * Hidden groups are hidden IN THE DATABASE: their youths, attendance and
--   outreach are readable/writable by Admins (and the Church Admin) only.
-- * New Group Transition (preview = the run itself, rolled back): blocked
--   while the hand-over group holds anyone, archive tool, hand-over choice
--   for several graduating classes (D12), grants of the graduating groups
--   roll back to the new level 1 unless the person still serves a group
--   that stays (Q12), their youths' assignments are cleared (D8).
-- * Moving a servant to another group clears their assignments in the
--   group they leave (Q6).
-- * Check-in: switched-off codes refuse; a shared code lists every group
--   sharing it and places new sign-ups by birth year (Q11).
--
-- NOTHING IS LOST: no youth, attendance, outreach, grant or QR code is
-- removed or moved. Names, colours and QR tokens of existing groups are
-- unchanged (checked at the end). The new hand-over groups start empty, so
-- nobody gains or loses access to any youth when this runs.
--
-- No new tables (so the Oct 2026 Data API grants change doesn't apply) and
-- no new enum VALUES on existing types (one new type, group_kind), so it
-- stays one transaction.

-- 0. Preconditions --------------------------------------------------------
do $$
declare
  v_bad text;
begin
  if current_schema() not in ('qa', 'prod') then
    raise exception 'Run with search_path set to qa or prod (got %)', current_schema();
  end if;
  if to_regprocedure(current_schema() || '.accessible_group_ids(boolean)') is null then
    raise exception '0067 is not applied';
  end if;
  if exists (select 1 from information_schema.columns
             where table_schema = current_schema() and table_name = 'groups' and column_name = 'kind') then
    raise exception 'Already applied: groups.kind exists';
  end if;
  -- Every ministry has exactly one active level-0 (pre-entry) group.
  select string_agg(m.id, ', ') into v_bad from ministries m
  where (select count(*) from groups g where g.ministry_id = m.id and not g.is_archived and g.ladder_position = 0) <> 1;
  if v_bad is not null then raise exception 'Ministries without exactly one pre-entry group: %', v_bad; end if;
  -- Nobody holds a role on a group that becomes hidden.
  select string_agg(ur.role::text || ' of ' || ur.user_id || ' on ' || g.name, '; ') into v_bad
  from user_roles ur join groups g on g.id = ur.group_id
  where g.ladder_position = 0 and not g.is_archived;
  if v_bad is not null then raise exception 'Remove these role grants on the pre-entry group first: %', v_bad; end if;
  -- Active names are unique per ministry (the new functions keep it so).
  select string_agg(ministry_id || ':' || n, ', ') into v_bad from (
    select ministry_id, lower(trim(name)) n from groups where not is_archived
    group by 1, 2 having count(*) > 1) d;
  if v_bad is not null then raise exception 'Duplicate active group names: %', v_bad; end if;
end
$$;

-- Counts and group fingerprints before, for the post-checks and the undo.
create temp table _ladder_before on commit drop as
select (select count(*) from members) as members,
       (select count(*) from attendance_records) as attendance,
       (select count(*) from outreach_entries) as outreach,
       (select count(*) from user_roles) as grants,
       (select count(*) from qr_codes) as qr_codes;

do $$
begin
  execute format('create schema if not exists %I', current_schema() || '_premm_backup');
  execute format('revoke all on schema %I from public, anon, authenticated', current_schema() || '_premm_backup');
  execute format('drop table if exists %I.ladder_0069_groups', current_schema() || '_premm_backup');
  execute format('create table %I.ladder_0069_groups as
                    select g.id, g.ministry_id, g.name, g.ladder_position, g.display_order, g.cohort_year, g.qr_color,
                           g.is_archived, (select array_agg(q.check_in_token order by q.check_in_token)
                                           from qr_codes q where q.group_id = g.id) as tokens
                    from groups g', current_schema() || '_premm_backup');
  execute format('drop table if exists %I.ladder_0069_settings', current_schema() || '_premm_backup');
  execute format('create table %I.ladder_0069_settings as select ministry_id, group_name_template from app_settings',
                 current_schema() || '_premm_backup');
end
$$;

-- 1. Columns ----------------------------------------------------------------

create type group_kind as enum ('pre_entry', 'regular', 'terminal');

alter table groups
  add column kind group_kind,
  add column name_pattern text,
  add column qr_active boolean not null default true,
  add column check_in_code_group_id uuid;

update groups set kind = case when ladder_position = 0 then 'pre_entry'::group_kind else 'regular'::group_kind end;
-- D5 default: the pre-entry QR is off (used only around August).
update groups set qr_active = false where kind = 'pre_entry';

alter table groups
  alter column kind set not null,
  add constraint groups_kind_level_check check ((kind = 'pre_entry') = (ladder_position = 0)),
  add constraint groups_regular_qr_active_check check (kind <> 'regular' or qr_active),
  add constraint groups_check_in_code_not_self check (check_in_code_group_id is distinct from id),
  add constraint groups_check_in_code_fkey foreign key (ministry_id, check_in_code_group_id)
    references groups (ministry_id, id) deferrable initially deferred;

create unique index uq_groups_one_pre_entry on groups (ministry_id) where kind = 'pre_entry' and not is_archived;

-- Classes share a cohort year, and archived rows must not block reuse
-- (GROUP_LADDER_PLAN §2.2). Cohort year becomes bookkeeping only.
alter table groups drop constraint groups_ministry_cohort_year_key;
create index idx_groups_ministry_cohort_year on groups (ministry_id, cohort_year);

drop index idx_groups_ladder_position;
drop index idx_groups_ministry_position;
create index idx_groups_ministry_kind_level on groups (ministry_id, kind, ladder_position) where not is_archived;
create index idx_groups_check_in_code on groups (check_in_code_group_id) where check_in_code_group_id is not null;

alter table app_settings
  add column level_number_offset smallint not null default 0 check (level_number_offset between 0 and 50),
  add column terminal_name_pattern text not null default '{cohort_year} - Transitioning'
    check (length(trim(terminal_name_pattern)) > 0);

-- Q3: SAY's default pattern now matches its real names.
update app_settings set group_name_template = '{cohort_year} - Yr {level}'
where ministry_id = 'SAY' and group_name_template = '{cohort_year} Cohort - Yr {position_label}';

-- 2. Small helpers --------------------------------------------------------

-- A name from a pattern. {level} (and its old spelling {position_label}) is
-- the displayed number (level + the ministry's offset); {label} is the
-- ministry's level word ("Yr", "Gr"). Spaces and dashes left at either end by
-- an empty placeholder are trimmed ("{cohort_year} - Transitioning" with no
-- year -> "Transitioning").
create or replace function render_group_name(p_pattern text, p_cohort_year integer, p_level integer,
                                              p_offset integer, p_label text)
returns text language sql immutable as $$
  select btrim(replace(replace(replace(replace(coalesce(p_pattern, ''),
           '{cohort_year}', coalesce(p_cohort_year::text, '')),
           '{level}', (coalesce(p_level, 0) + coalesce(p_offset, 0))::text),
           '{position_label}', (coalesce(p_level, 0) + coalesce(p_offset, 0))::text),
           '{label}', coalesce(p_label, '')), ' -');
$$;

-- A QR colour as far as possible from every colour the ministry already
-- uses (its active groups and the Servants code) -- A8.
create or replace function pick_group_color(p_m text)
returns text language sql stable security definer as $$
  with used as (
    select lower(qr_color) c from groups
    where ministry_id = p_m and not is_archived and qr_color ~* '^#[0-9a-f]{6}$'
    union
    select lower(servants_qr_color) from app_settings
    where ministry_id = p_m and servants_qr_color ~* '^#[0-9a-f]{6}$'
  ), u as (
    select ('x' || substr(c, 2, 2))::bit(8)::int r, ('x' || substr(c, 4, 2))::bit(8)::int g,
           ('x' || substr(c, 6, 2))::bit(8)::int b from used
  ), cand as (
    select c, ord, ('x' || substr(c, 2, 2))::bit(8)::int r, ('x' || substr(c, 4, 2))::bit(8)::int g,
           ('x' || substr(c, 6, 2))::bit(8)::int b
    from unnest(array['#c62828', '#1565c0', '#2e7d32', '#ef6c00', '#6a1b9a', '#00838f', '#ad1457', '#4e342e',
                      '#283593', '#558b2f', '#00695c', '#d84315', '#37474f', '#9e9d24', '#0277bd', '#8e24aa',
                      '#424242', '#bf360c']) with ordinality as t(c, ord)
  )
  select upper(cand.c) from cand
  order by coalesce((select min(sqrt(power(cand.r - u.r, 2) + power(cand.g - u.g, 2) + power(cand.b - u.b, 2))) from u),
                    1000) desc, cand.ord
  limit 1;
$$;

create or replace function assert_group_name_free(p_m text, p_name text, p_except uuid default null)
returns void language plpgsql stable security definer as $$
begin
  if nullif(trim(p_name), '') is null then raise exception 'Name cannot be empty'; end if;
  if exists (select 1 from groups where ministry_id = p_m and not is_archived
             and lower(trim(name)) = lower(trim(p_name)) and id is distinct from p_except) then
    raise exception 'Another group is already called "%"', trim(p_name);
  end if;
end
$$;

-- Display order: pre-entry first, regular groups (p_first first when given),
-- hand-over group(s) last, archived rows after everything.
create or replace function tidy_group_order(p_m text, p_first uuid default null)
returns void language sql security definer as $$
  with o as (
    select id, row_number() over (order by is_archived,
             case kind when 'pre_entry' then 0 when 'regular' then 1 else 2 end,
             case when id = p_first then 0 else 1 end,
             display_order, ladder_position, created_at, id) as rn
    from groups where ministry_id = p_m
  )
  update groups g set display_order = o.rn from o where g.id = o.id and g.display_order is distinct from o.rn;
$$;

-- Levels stay 1..N with no gaps; hand-over group(s) at N+1.
create or replace function normalize_group_levels(p_m text)
returns void language plpgsql security definer as $$
begin
  with r as (
    select id, dense_rank() over (order by ladder_position)::smallint dr
    from groups where ministry_id = p_m and kind = 'regular' and not is_archived
  )
  update groups g set ladder_position = r.dr from r where g.id = r.id and g.ladder_position <> r.dr;
  update groups set ladder_position = coalesce((select max(ladder_position) from groups
                                                where ministry_id = p_m and kind = 'regular' and not is_archived), 0) + 1
  where ministry_id = p_m and kind = 'terminal' and not is_archived;
end
$$;

-- A group's check-in code(s) now belong to p_to; groups that shared p_from's
-- code share p_to's (D13: the poster keeps working when its group leaves).
create or replace function transfer_check_in_code(p_from uuid, p_to uuid)
returns void language sql security definer as $$
  update qr_codes set group_id = p_to where group_id = p_from;
  update groups set check_in_code_group_id = case when id = p_to then null else p_to end
  where check_in_code_group_id = p_from;
$$;

-- 3. Backfill: patterns, order, the hand-over group -----------------------

-- A group keeps a yearly name pattern only if its current name is exactly
-- what the ministry's default pattern gives (otherwise it keeps its name, the
-- 0033 principle). SAY: "2008 - Yr 1" ok; "2004 & older" none.
update groups g set name_pattern = s.group_name_template
from app_settings s
where s.ministry_id = g.ministry_id and not g.is_archived and g.cohort_year is not null
  and s.group_name_template is not null
  and render_group_name(s.group_name_template, g.cohort_year, g.ladder_position, 0, s.ladder_position_label) = g.name;

do $$
declare
  m record;
  v_n integer;
  v_id uuid;
  v_name text;
begin
  for m in select id from ministries order by id loop
    select coalesce(max(ladder_position), 0) into v_n
    from groups where ministry_id = m.id and kind = 'regular' and not is_archived;
    v_name := case when m.id = 'SAY' then '2002 - Transitioning' else 'Transitioning' end;
    perform assert_group_name_free(m.id, v_name);
    insert into groups (ministry_id, kind, cohort_year, ladder_position, name, display_order, qr_color, qr_active)
    values (m.id, 'terminal', case when m.id = 'SAY' then 2002 end, v_n + 1, v_name, 100000,
            pick_group_color(m.id), true)
    returning id into v_id;
    insert into qr_codes (ministry_id, group_id, label, image_path, flow_type)
    values (m.id, v_id, v_name, '', 'check_in_and_intake');
    perform tidy_group_order(m.id);
  end loop;
end
$$;

-- 4. Group functions (App Settings) ---------------------------------------

create or replace function add_group(p_name text, p_level integer default null, p_cohort_year integer default null,
                                     p_qr_color text default null, p_name_pattern text default null)
returns uuid language plpgsql security definer as $$
declare
  v_m text := current_ministry_id();
  v_n integer;
  v_level integer;
  v_id uuid;
  v_name text := trim(p_name);
  v_color text := nullif(trim(p_qr_color), '');
begin
  if not is_admin_in(v_m) then raise exception 'Only Admins may add a group'; end if;
  perform assert_group_name_free(v_m, v_name);
  if v_color is not null and v_color !~ '^#[0-9A-Fa-f]{6}$' then raise exception 'Colour must look like #1A2B3C'; end if;
  if nullif(trim(p_name_pattern), '') is not null and p_name_pattern !~ '\{(level|cohort_year|position_label)\}' then
    raise exception 'A yearly name pattern needs {level} or {cohort_year}';
  end if;
  perform 1 from groups where ministry_id = v_m and not is_archived for update;
  select coalesce(max(ladder_position), 0) into v_n from groups where ministry_id = v_m and kind = 'regular' and not is_archived;
  v_level := coalesce(p_level, v_n + 1);
  if v_level < 1 or v_level > v_n + 1 then raise exception 'Level must be between 1 and %', v_n + 1; end if;

  insert into groups (ministry_id, kind, cohort_year, ladder_position, name, display_order, qr_color, name_pattern)
  values (v_m, 'regular', p_cohort_year, v_level, v_name, 99999, coalesce(upper(v_color), pick_group_color(v_m)),
          nullif(trim(p_name_pattern), ''))
  returning id into v_id;
  insert into qr_codes (ministry_id, group_id, label, image_path, flow_type)
  values (v_m, v_id, v_name, '', 'check_in_and_intake');
  perform normalize_group_levels(v_m);
  perform tidy_group_order(v_m);
  return v_id;
end
$$;

-- Old name kept so the previous app version keeps working during a deploy.
create or replace function add_group_tier(p_cohort_year integer default null, p_name text default null, p_qr_color text default '#999999')
returns uuid language sql security definer as $$
  select add_group(p_name, null, p_cohort_year, p_qr_color, null);
$$;

create or replace function delete_group_tier(p_group_id uuid)
returns void language plpgsql security definer as $$
declare
  v_m text := current_ministry_id();
  v_kind group_kind;
  v_count integer;
begin
  if not is_admin_in(v_m) then raise exception 'Only Admins may remove a group'; end if;
  select kind into v_kind from groups where id = p_group_id and ministry_id = v_m and not is_archived;
  if v_kind is null then raise exception 'Group not found or already archived'; end if;
  if v_kind <> 'regular' then raise exception 'The pre-entry and hand-over groups cannot be removed'; end if;

  select count(*) into v_count from members where ministry_id = v_m and group_id = p_group_id and status = 'active';
  if v_count > 0 then
    raise exception 'This group still has % active member(s) -- move them to another group first', v_count;
  end if;
  select count(*) into v_count from user_roles where ministry_id = v_m and group_id = p_group_id;
  if v_count > 0 then
    raise exception 'This group still has % servant/coordinator role grant(s) -- reassign them first', v_count;
  end if;
  if exists (select 1 from groups where check_in_code_group_id = p_group_id and not is_archived) then
    raise exception 'Other groups use this group''s check-in code -- give them their own code first';
  end if;

  delete from qr_codes where ministry_id = v_m and group_id = p_group_id;
  update groups set is_archived = true where id = p_group_id;
  perform normalize_group_levels(v_m);
  perform tidy_group_order(v_m);
end
$$;

create or replace function rename_group(p_group_id uuid, p_name text)
returns void language plpgsql security definer as $$
declare
  v_m text := current_ministry_id();
begin
  if not is_admin_in(v_m) then raise exception 'Only Admins may rename a group'; end if;
  perform assert_group_name_free(v_m, p_name, p_group_id);
  update groups set name = trim(p_name) where id = p_group_id and ministry_id = v_m and not is_archived;
  if not found then raise exception 'Group not found'; end if;
  update qr_codes set label = trim(p_name) where group_id = p_group_id and ministry_id = v_m;
end
$$;

create or replace function move_group(p_group_id uuid, p_direction text)
returns void language plpgsql security definer as $$
declare
  v_m text := current_ministry_id();
  v_ord integer;
  v_other uuid;
  v_other_ord integer;
begin
  if not is_admin_in(v_m) then raise exception 'Only Admins may reorder groups'; end if;
  if p_direction not in ('up', 'down') then raise exception 'Direction must be up or down'; end if;
  perform 1 from groups where ministry_id = v_m and not is_archived for update;
  perform tidy_group_order(v_m);
  select display_order into v_ord from groups
  where id = p_group_id and ministry_id = v_m and kind = 'regular' and not is_archived;
  if v_ord is null then raise exception 'Only regular groups can be moved'; end if;
  select id, display_order into v_other, v_other_ord from groups
  where ministry_id = v_m and kind = 'regular' and not is_archived
    and ((p_direction = 'up' and display_order < v_ord) or (p_direction = 'down' and display_order > v_ord))
  order by case when p_direction = 'up' then -display_order else display_order end
  limit 1;
  if v_other is null then return; end if;
  update groups set display_order = v_other_ord where id = p_group_id;
  update groups set display_order = v_ord where id = v_other;
end
$$;

create or replace function set_group_level(p_group_id uuid, p_level integer)
returns void language plpgsql security definer as $$
declare
  v_m text := current_ministry_id();
  v_n integer;
begin
  if not is_admin_in(v_m) then raise exception 'Only Admins may change a group''s level'; end if;
  perform 1 from groups where ministry_id = v_m and not is_archived for update;
  if not exists (select 1 from groups where id = p_group_id and ministry_id = v_m and kind = 'regular' and not is_archived) then
    raise exception 'Only regular groups have a level to change';
  end if;
  select coalesce(max(ladder_position), 0) into v_n from groups where ministry_id = v_m and kind = 'regular' and not is_archived;
  if p_level is null or p_level < 1 or p_level > v_n + 1 then raise exception 'Level must be between 1 and %', v_n + 1; end if;
  -- A new top level is stored above everything, then closed up.
  update groups set ladder_position = case when p_level = v_n + 1 then 30000 else p_level end where id = p_group_id;
  perform normalize_group_levels(v_m);
end
$$;

create or replace function set_group_name_pattern(p_group_id uuid, p_pattern text)
returns void language plpgsql security definer as $$
declare
  v_m text := current_ministry_id();
  v_pattern text := nullif(trim(p_pattern), '');
begin
  if not is_admin_in(v_m) then raise exception 'Only Admins may change a name pattern'; end if;
  if v_pattern is not null and v_pattern !~ '\{(level|cohort_year|position_label)\}' then
    raise exception 'A yearly name pattern needs {level} or {cohort_year} (or leave it empty to keep the name as it is)';
  end if;
  update groups set name_pattern = v_pattern
  where id = p_group_id and ministry_id = v_m and kind <> 'terminal' and not is_archived;
  if not found then raise exception 'Group not found (the hand-over group uses the hand-over name pattern)'; end if;
end
$$;

-- D5: the "QR code active" switch of a pre-entry or hand-over group.
create or replace function set_group_qr_active(p_group_id uuid, p_active boolean)
returns void language plpgsql security definer as $$
declare
  v_m text := current_ministry_id();
begin
  if not is_admin_in(v_m) then raise exception 'Only Admins may switch a QR code on or off'; end if;
  update groups set qr_active = coalesce(p_active, false)
  where id = p_group_id and ministry_id = v_m and kind <> 'regular' and not is_archived;
  if not found then raise exception 'Only the pre-entry and hand-over groups have a QR switch'; end if;
end
$$;

-- D13: use another group's check-in code (null = back to its own code).
create or replace function set_group_check_in_code(p_group_id uuid, p_code_group_id uuid)
returns void language plpgsql security definer as $$
declare
  v_m text := current_ministry_id();
  g groups%rowtype;
  c groups%rowtype;
begin
  if not is_admin_in(v_m) then raise exception 'Only Admins may change a group''s check-in code'; end if;
  select * into g from groups where id = p_group_id and ministry_id = v_m and not is_archived;
  if g.id is null then raise exception 'Group not found'; end if;
  if g.kind = 'pre_entry' then raise exception 'The pre-entry group always has its own (intake-only) code'; end if;

  if p_code_group_id is null then
    if g.check_in_code_group_id is null then return; end if;
    update groups set check_in_code_group_id = null where id = g.id;
    insert into qr_codes (ministry_id, group_id, label, image_path, flow_type)
    values (v_m, g.id, g.name, '', 'check_in_and_intake');
    return;
  end if;

  select * into c from groups where id = p_code_group_id and ministry_id = v_m and not is_archived;
  if c.id is null then raise exception 'The group whose code you chose was not found'; end if;
  if c.id = g.id then raise exception 'A group cannot share its own code'; end if;
  if c.kind = 'pre_entry' then raise exception 'The pre-entry group''s intake-only code cannot be shared'; end if;
  if c.check_in_code_group_id is not null then
    raise exception '"%" already uses another group''s code -- choose that group instead', c.name;
  end if;
  if exists (select 1 from groups where check_in_code_group_id = g.id and not is_archived) then
    raise exception 'Other groups use "%"''s code, so it must keep its own', g.name;
  end if;
  delete from qr_codes where ministry_id = v_m and group_id = g.id;
  update groups set check_in_code_group_id = c.id where id = g.id;
end
$$;

-- 5. Group Transition --------------------------------------------------------
-- One internal function does everything; preview_group_transition() runs it
-- and undoes it, so the preview can never disagree with the run (the old
-- TypeScript preview did, §2.2).

create or replace function group_transition_core(p_new_pre_entry_cohort_year integer, p_new_pre_entry_name text,
                                                 p_new_terminal_names text[], p_handover_mode text)
returns jsonb language plpgsql security definer as $$
declare
  v_m text := current_ministry_id();
  s app_settings%rowtype;
  v_pre groups%rowtype;
  v_perm groups%rowtype;
  v_n integer;
  v_levels integer;
  v_count integer;
  v_occupants jsonb;
  v_top uuid[];
  v_top_names text[];
  v_mode text;
  v_cy integer;
  v_base text;
  v_names text[];
  v_targets uuid[] := '{}';
  v_color text;
  v_new_pre_name text;
  v_new_pre_id uuid;
  v_before jsonb;
  v_grants_moved jsonb;
  v_grants_dropped jsonb;
  v_cleared jsonb;
  v_cleared_total integer;
  v_unknown_gender jsonb := '[]';
  v_moved integer;
  v_extra_archived text[];
  v_dup text;
  v_id uuid;
  v_i integer;
  r record;
begin
  if not is_admin_in(v_m) then raise exception 'Only Admins may run a Group Transition'; end if;
  if p_new_pre_entry_cohort_year is null then raise exception 'Give the new pre-entry group''s year'; end if;
  select * into s from app_settings where ministry_id = v_m;
  perform 1 from groups where ministry_id = v_m and not is_archived for update;

  -- Ladder sanity.
  select * into v_pre from groups where ministry_id = v_m and kind = 'pre_entry' and not is_archived;
  if v_pre.id is null then raise exception 'This ministry has no pre-entry group'; end if;
  select * into v_perm from groups where ministry_id = v_m and kind = 'terminal' and not is_archived
  order by created_at, display_order limit 1;
  if v_perm.id is null then raise exception 'This ministry has no hand-over group'; end if;
  select max(ladder_position), count(distinct ladder_position) into v_n, v_levels
  from groups where ministry_id = v_m and kind = 'regular' and not is_archived;
  if v_n is null then
    raise exception 'There is no group between the pre-entry and hand-over groups -- add one in App Settings first';
  end if;
  if v_levels <> v_n then raise exception 'The group levels have a gap -- fix them in App Settings first'; end if;

  -- D6: blocked while any hand-over group holds an active youth.
  select count(*), coalesce(jsonb_agg(jsonb_build_object('id', m.id, 'name', m.full_name, 'group', g.name)
                                      order by m.full_name), '[]'::jsonb)
    into v_count, v_occupants
  from members m join groups g on g.id = m.group_id
  where m.ministry_id = v_m and m.status = 'active' and g.kind = 'terminal' and not g.is_archived;
  if v_count > 0 then
    return jsonb_build_object('blocked', true, 'occupant_count', v_count, 'occupants', v_occupants,
      'hand_over_groups', (select jsonb_agg(name order by display_order) from groups
                           where ministry_id = v_m and kind = 'terminal' and not is_archived));
  end if;

  -- The graduating group(s), the hand-over choice (D12) and suggested names.
  select array_agg(id order by display_order, name), array_agg(name order by display_order, name)
    into v_top, v_top_names
  from groups where ministry_id = v_m and kind = 'regular' and not is_archived and ladder_position = v_n;
  v_mode := case when cardinality(v_top) < 2 then 'one' else coalesce(nullif(trim(p_handover_mode), ''), 'one') end;
  if v_mode not in ('one', 'by_gender', 'separate') then raise exception 'Unknown hand-over choice %', v_mode; end if;

  select case when count(*) filter (where cohort_year is null) = 0 and count(distinct cohort_year) = 1
              then min(cohort_year) end
    into v_cy from groups where id = any(v_top);
  v_base := render_group_name(s.terminal_name_pattern, coalesce(v_cy, v_perm.cohort_year), 0, 0, s.ladder_position_label);
  v_names := case v_mode
    when 'one' then array[v_base]
    when 'by_gender' then array[v_base || ' Boys', v_base || ' Girls']
    else (select array_agg(v_base || ' ' || n order by o) from unnest(v_top_names) with ordinality t(n, o))
  end;
  for v_i in 1 .. cardinality(v_names) loop
    if nullif(trim(p_new_terminal_names[v_i]), '') is not null then v_names[v_i] := trim(p_new_terminal_names[v_i]); end if;
  end loop;

  v_new_pre_name := coalesce(nullif(trim(p_new_pre_entry_name), ''),
    case when s.group_name_template ~ '\{(level|cohort_year|position_label)\}' then
      render_group_name(s.group_name_template, p_new_pre_entry_cohort_year, 0, s.level_number_offset, s.ladder_position_label)
    end);
  if v_new_pre_name is null then raise exception 'Give the new pre-entry group a name'; end if;

  -- What will happen to people, recorded before anything changes.
  select coalesce(jsonb_agg(jsonb_build_object('id', g.id, 'name', g.name, 'kind', g.kind, 'level', g.ladder_position,
                                               'cohort_year', g.cohort_year) order by g.display_order), '[]'::jsonb)
    into v_before from groups g where g.ministry_id = v_m and not g.is_archived;

  -- Q12: grants on a graduating group are dropped when the person still
  -- holds a grant on a regular group that stays; the rest roll back (D8).
  select coalesce(jsonb_agg(jsonb_build_object('person', coalesce(p.full_name, ur.user_id::text), 'role', ur.role,
                                               'from', g.name) order by p.full_name, ur.role)
                  filter (where keeps), '[]'::jsonb),
         coalesce(jsonb_agg(jsonb_build_object('person', coalesce(p.full_name, ur.user_id::text), 'role', ur.role,
                                               'from', g.name) order by p.full_name, ur.role)
                  filter (where not keeps), '[]'::jsonb)
    into v_grants_dropped, v_grants_moved
  from (select ur.*, exists (select 1 from user_roles o join groups og on og.id = o.group_id
                             where o.ministry_id = v_m and o.user_id = ur.user_id and og.kind = 'regular'
                               and not og.is_archived and not (o.group_id = any(v_top))) as keeps
        from user_roles ur where ur.ministry_id = v_m and ur.group_id = any(v_top)) ur
  join groups g on g.id = ur.group_id
  left join profiles p on p.ministry_id = v_m and p.id = ur.user_id;

  select coalesce(jsonb_agg(jsonb_build_object('servant', coalesce(p.full_name, x.sid::text), 'count', x.n)
                            order by p.full_name), '[]'::jsonb), coalesce(sum(x.n), 0)
    into v_cleared, v_cleared_total
  from (select assigned_servant_id sid, count(*) n from members
        where ministry_id = v_m and group_id = any(v_top) and assigned_servant_id is not null group by 1) x
  left join profiles p on p.ministry_id = v_m and p.id = x.sid;

  -- (a) Emptied extra hand-over groups from an earlier "per gender" or
  --     "separate" transition are archived; the permanent one stays.
  select array_agg(name) into v_extra_archived from groups
  where ministry_id = v_m and kind = 'terminal' and not is_archived and id <> v_perm.id;
  for r in select id from groups where ministry_id = v_m and kind = 'terminal' and not is_archived and id <> v_perm.id loop
    if exists (select 1 from groups where check_in_code_group_id = r.id and not is_archived) then
      perform transfer_check_in_code(r.id, v_perm.id);
    else
      delete from qr_codes where group_id = r.id;
    end if;
    update groups set is_archived = true, check_in_code_group_id = null where id = r.id;
  end loop;

  -- (b) Every staying regular group goes up a level; the pre-entry becomes
  --     level 1 with a check-in code (Q9: listed first among the regular groups).
  update groups set ladder_position = ladder_position + 1
  where ministry_id = v_m and kind = 'regular' and not is_archived and not (id = any(v_top));
  update groups set kind = 'regular', ladder_position = 1, qr_active = true, check_in_code_group_id = null
  where id = v_pre.id;
  update qr_codes set flow_type = 'check_in_and_intake' where ministry_id = v_m and group_id = v_pre.id;

  -- (c) Hand-over targets (D12).
  update groups set ladder_position = v_n + 1, name = v_names[1],
                    cohort_year = coalesce(case when v_mode = 'separate'
                                                then (select cohort_year from groups where id = v_top[1]) else v_cy end,
                                           cohort_year)
  where id = v_perm.id;
  v_targets := array[v_perm.id];
  if v_mode in ('by_gender', 'separate') then
    for v_i in 2 .. cardinality(v_names) loop
      insert into groups (ministry_id, kind, cohort_year, ladder_position, name, display_order, qr_color, qr_active)
      values (v_m, 'terminal',
              case when v_mode = 'separate' then (select cohort_year from groups where id = v_top[v_i]) else v_cy end,
              v_n + 1, v_names[v_i], 100000 + v_i, pick_group_color(v_m), true)
      returning id into v_id;
      insert into qr_codes (ministry_id, group_id, label, image_path, flow_type)
      values (v_m, v_id, v_names[v_i], '', 'check_in_and_intake');
      v_targets := v_targets || v_id;
    end loop;
  end if;

  -- (d) Youths of the graduating group(s) move to hand-over; their
  --     assignments are cleared (D8).
  if v_mode = 'by_gender' then
    select coalesce(jsonb_agg(full_name order by full_name), '[]'::jsonb) into v_unknown_gender
    from members where ministry_id = v_m and group_id = any(v_top) and status = 'active'
      and (gender is null or gender not in ('Male', 'Female'));
    update members set group_id = case when gender = 'Female' then v_targets[2] else v_targets[1] end,
                       assigned_servant_id = null, is_new_assignment = false
    where ministry_id = v_m and group_id = any(v_top);
  elsif v_mode = 'separate' then
    for v_i in 1 .. cardinality(v_top) loop
      update members set group_id = v_targets[v_i], assigned_servant_id = null, is_new_assignment = false
      where ministry_id = v_m and group_id = v_top[v_i];
    end loop;
  else
    update members set group_id = v_perm.id, assigned_servant_id = null, is_new_assignment = false
    where ministry_id = v_m and group_id = any(v_top);
  end if;
  select count(*) into v_moved from members where ministry_id = v_m and group_id = any(v_targets) and status = 'active';

  -- (e) Grants: Q12 drops first, then duplicates, then roll back to level 1.
  delete from user_roles ur
  where ur.ministry_id = v_m and ur.group_id = any(v_top)
    and exists (select 1 from user_roles o join groups og on og.id = o.group_id
                where o.ministry_id = v_m and o.user_id = ur.user_id and og.kind = 'regular' and not og.is_archived
                  and not (o.group_id = any(v_top)) and o.group_id <> v_pre.id);
  delete from user_roles ur
  where ur.ministry_id = v_m and ur.group_id = any(v_top)
    and exists (select 1 from user_roles x where x.ministry_id = v_m and x.user_id = ur.user_id and x.role = ur.role
                  and (x.group_id = v_pre.id or (x.group_id = any(v_top) and x.id::text < ur.id::text)));
  update user_roles set group_id = v_pre.id where ministry_id = v_m and group_id = any(v_top);

  -- (f) Codes of the graduating groups: a code other groups still share
  --     passes to the hand-over group (D13); the rest are removed.
  for v_i in 1 .. cardinality(v_top) loop
    if exists (select 1 from groups where check_in_code_group_id = v_top[v_i] and not is_archived
               and not (id = any(v_top))) then
      perform transfer_check_in_code(v_top[v_i],
        v_targets[case when v_mode = 'separate' then v_i else 1 end]);
    else
      delete from qr_codes where ministry_id = v_m and group_id = v_top[v_i];
    end if;
  end loop;
  select qr_color into v_color from groups where id = v_top[1];
  update groups set is_archived = true, check_in_code_group_id = null where id = any(v_top);

  -- (g) Yearly names (regular groups with a pattern; the former pre-entry too).
  update groups set name = render_group_name(name_pattern, cohort_year, ladder_position,
                                             s.level_number_offset, s.ladder_position_label)
  where ministry_id = v_m and kind = 'regular' and not is_archived and name_pattern is not null
    and render_group_name(name_pattern, cohort_year, ladder_position, s.level_number_offset, s.ladder_position_label) <> '';

  -- (h) The new pre-entry group: intake-only code, switched off (D5).
  insert into groups (ministry_id, kind, cohort_year, ladder_position, name, display_order, qr_color, qr_active,
                      name_pattern)
  values (v_m, 'pre_entry', p_new_pre_entry_cohort_year, 0, v_new_pre_name, 0,
          coalesce(v_color, pick_group_color(v_m)), false,
          case when s.group_name_template ~ '\{(level|cohort_year|position_label)\}' then s.group_name_template end)
  returning id into v_new_pre_id;
  insert into qr_codes (ministry_id, group_id, label, image_path, flow_type)
  values (v_m, v_new_pre_id, v_new_pre_name, '', 'intake_only');

  -- (i) Names must stay unique.
  select string_agg(n, ', ') into v_dup from (
    select min(name) n from groups where ministry_id = v_m and not is_archived
    group by lower(trim(name)) having count(*) > 1) d;
  if v_dup is not null then raise exception 'After this transition two groups would have the same name: %', v_dup; end if;

  -- (j) Labels and order.
  update qr_codes q set label = g.name from groups g
  where q.group_id = g.id and q.ministry_id = v_m and not g.is_archived and q.label is distinct from g.name;
  perform tidy_group_order(v_m, v_pre.id);

  insert into audit_log (ministry_id, user_id, action_type, details)
  values (v_m, auth.uid(), 'GROUP_TRANSITION_RUN', jsonb_build_object(
    'model', 'group_ladder_0069', 'new_pre_entry', v_new_pre_name, 'new_pre_entry_cohort_year', p_new_pre_entry_cohort_year,
    'graduated', to_jsonb(v_top_names), 'hand_over_mode', v_mode, 'hand_over_groups', to_jsonb(v_names),
    'youths_to_hand_over', v_moved, 'grants_moved', jsonb_array_length(v_grants_moved),
    'grants_dropped', jsonb_array_length(v_grants_dropped), 'assignments_cleared', v_cleared_total));

  return jsonb_build_object(
    'blocked', false,
    'mode', v_mode,
    'graduating', to_jsonb(v_top_names),
    'hand_over_names', to_jsonb(v_names),
    'hand_over_youths', v_moved,
    'unknown_gender', v_unknown_gender,
    'new_pre_entry', jsonb_build_object('name', v_new_pre_name, 'cohort_year', p_new_pre_entry_cohort_year),
    'new_level_one', (select name from groups where id = v_pre.id),
    'grants_moved', v_grants_moved,
    'grants_dropped', v_grants_dropped,
    'assignments_cleared', v_cleared,
    'assignments_cleared_total', v_cleared_total,
    'extra_hand_over_archived', coalesce(to_jsonb(v_extra_archived), '[]'::jsonb),
    'groups', (select jsonb_agg(jsonb_build_object(
                 'id', b.v->>'id', 'old_name', b.v->>'name', 'old_kind', b.v->>'kind', 'old_level', (b.v->>'level')::int,
                 'new_name', g.name, 'new_kind', g.kind, 'new_level', g.ladder_position, 'archived', g.is_archived)
                 order by (b.v->>'level')::int, b.v->>'name')
               from jsonb_array_elements(v_before) b(v) join groups g on g.id = (b.v->>'id')::uuid),
    'new_groups', (select coalesce(jsonb_agg(jsonb_build_object('name', g.name, 'kind', g.kind, 'level', g.ladder_position)
                                             order by g.display_order), '[]'::jsonb)
                   from groups g where g.ministry_id = v_m and not g.is_archived
                     and not exists (select 1 from jsonb_array_elements(v_before) b(v) where (b.v->>'id')::uuid = g.id)));
end
$$;

-- What a transition would do, without doing it (the run, rolled back).
-- Never raises for a business rule: returns {"error": "..."} instead.
create or replace function preview_group_transition(p_new_pre_entry_cohort_year integer,
                                                    p_new_pre_entry_name text default null,
                                                    p_new_terminal_names text[] default null,
                                                    p_handover_mode text default null)
returns jsonb language plpgsql security definer as $$
declare
  v jsonb;
begin
  if not is_admin_in(current_ministry_id()) then raise exception 'Only Admins may preview a Group Transition'; end if;
  begin
    v := group_transition_core(p_new_pre_entry_cohort_year, p_new_pre_entry_name, p_new_terminal_names, p_handover_mode);
    raise exception 'TRANSITION_PREVIEW_UNDO';
  exception when others then
    if sqlerrm <> 'TRANSITION_PREVIEW_UNDO' then
      return jsonb_build_object('error', sqlerrm);
    end if;
  end;
  return v;
end
$$;

drop function run_group_transition(integer);
create function run_group_transition(p_new_pre_entry_cohort_year integer,
                                     p_new_pre_entry_name text default null,
                                     p_new_terminal_names text[] default null,
                                     p_handover_mode text default null)
returns jsonb language plpgsql security definer as $$
declare
  v jsonb;
begin
  v := group_transition_core(p_new_pre_entry_cohort_year, p_new_pre_entry_name, p_new_terminal_names, p_handover_mode);
  if (v ->> 'blocked')::boolean then
    raise exception 'The hand-over group still has % people. Archive them or hand them over first.', v ->> 'occupant_count';
  end if;
  return v;
end
$$;

-- D6: archive everyone still in the hand-over group(s). Their records,
-- attendance and outreach are kept; they stay in the (hidden) group.
create or replace function archive_terminal_members()
returns integer language plpgsql security definer as $$
declare
  v_m text := current_ministry_id();
  v_ids uuid[];
begin
  if not is_admin_in(v_m) then raise exception 'Only Admins may archive the hand-over group'; end if;
  with a as (
    update members m set status = 'archived', assigned_servant_id = null, is_new_assignment = false
    from groups g
    where g.id = m.group_id and g.kind = 'terminal' and not g.is_archived
      and m.ministry_id = v_m and m.status = 'active'
    returning m.id
  )
  select array_agg(id) into v_ids from a;
  if coalesce(cardinality(v_ids), 0) > 0 then
    insert into audit_log (ministry_id, user_id, action_type, details)
    values (v_m, auth.uid(), 'MEMBER_ARCHIVED',
            jsonb_build_object('reason', 'hand-over group archived', 'count', cardinality(v_ids), 'member_ids', to_jsonb(v_ids)));
  end if;
  return coalesce(cardinality(v_ids), 0);
end
$$;

-- 6. QR Codes page -----------------------------------------------------------
-- Q4 = No: a switched-off code is left out for everyone, Admins included.
drop function get_qr_codes_with_groups();
create function get_qr_codes_with_groups()
returns table(id uuid, label text, check_in_token uuid, updated_at timestamptz, group_id uuid, ladder_position integer,
              qr_color text, kind text, display_order integer, flow_type text, shared_with text[])
language sql stable security definer as $$
  select q.id, q.label, q.check_in_token, q.updated_at, q.group_id, g.ladder_position::integer, g.qr_color,
         g.kind::text, g.display_order, q.flow_type::text,
         (select array_agg(sg.name order by sg.display_order) from groups sg
          where sg.check_in_code_group_id = q.group_id and not sg.is_archived and sg.qr_active
            and (sg.kind = 'regular' or is_admin()))
  from qr_codes q
  left join groups g on g.id = q.group_id
  where q.ministry_id = current_ministry_id() and is_app_user()
    and (q.group_id is null or (not g.is_archived and g.qr_active));
$$;

-- 7. Access helpers: hidden groups are Admin-only -------------------------

-- Admins and the Church Admin: every group. General Coordinators: every
-- REGULAR group. Everyone else: the regular groups they hold a role at.
create or replace function accessible_group_ids(p_include_read_only boolean default true)
returns uuid[] language sql stable security definer as $$
  with me as (
    select auth.uid() as uid, current_ministry_id() as m
  ), f as (
    select me.uid, me.m,
           exists (select 1 from church_admins c where c.user_id = me.uid) as church_admin,
           exists (select 1 from ministries mi where mi.id = me.m and mi.is_active) as active,
           exists (select 1 from user_roles ur
                   where ur.ministry_id = me.m and ur.user_id = me.uid and ur.role = 'admin') as admin,
           exists (select 1 from user_roles ur
                   where ur.ministry_id = me.m and ur.user_id = me.uid and ur.role = 'general_coordinator') as gc
    from me
  )
  select coalesce(array_agg(g.id), '{}'::uuid[])
  from groups g, f
  where g.ministry_id = f.m
    and (f.church_admin
         or (f.active and (f.admin
             or (g.kind = 'regular' and (f.gc
                 or exists (select 1 from user_roles ur
                            where ur.ministry_id = f.m and ur.user_id = f.uid and ur.group_id = g.id
                              and (p_include_read_only or ur.role <> 'read_only')))))));
$$;

create or replace function has_group_access(gid uuid, uid uuid default auth.uid())
returns boolean language sql stable security definer as $$
  select coalesce((
    select g.ministry_id = current_ministry_id()
       and (is_admin_in(g.ministry_id, uid)
            or (g.kind = 'regular'
                and (is_admin_or_gc_in(g.ministry_id, uid)
                     or (ministry_is_active(g.ministry_id) and exists (
                           select 1 from user_roles ur
                           where ur.user_id = uid and ur.group_id = gid and ur.role <> 'read_only')))))
    from groups g where g.id = gid
  ), false);
$$;

create or replace function has_readonly_or_full_group_access(gid uuid, uid uuid default auth.uid())
returns boolean language sql stable security definer as $$
  select has_group_access(gid, uid) or coalesce((
    select g.ministry_id = current_ministry_id()
       and g.kind = 'regular'
       and ministry_is_active(g.ministry_id)
       and exists (select 1 from user_roles ur
                   where ur.user_id = uid and ur.group_id = gid and ur.role = 'read_only')
    from groups g where g.id = gid
  ), false);
$$;

create or replace function export_group_member_names(p_group_id uuid)
returns table(full_name text) language plpgsql security definer as $$
begin
  if not is_coordinator() then raise exception 'Only Coordinators/Admins can export a names list'; end if;
  if not is_admin() and exists (select 1 from groups where id = p_group_id and kind <> 'regular') then
    raise exception 'Only Admins can export a hidden group''s names';
  end if;
  return query
    select m.full_name from members m
    where m.ministry_id = current_ministry_id() and m.group_id = p_group_id and m.status = 'active'
    order by m.full_name;
end
$$;

-- Q6: moving a servant clears their assignments in the group they leave
-- (the screen warns with the count first).
create or replace function reassign_role_group(p_role_id uuid, p_group_id uuid)
returns void language plpgsql security definer as $$
declare
  v_m text := current_ministry_id();
  v_role app_role;
  v_user uuid;
  v_old uuid;
begin
  if not is_admin_or_gc_in(v_m) then raise exception 'Only General Coordinators/Admins can reassign a role grant'; end if;
  select role, user_id, group_id into v_role, v_user, v_old from user_roles where id = p_role_id and ministry_id = v_m;
  if v_role is null then raise exception 'Role grant not found'; end if;
  if v_role <> 'servant' then raise exception 'Only Servant grants can be reassigned to a different group here'; end if;
  if p_group_id is not null and not exists (select 1 from groups where id = p_group_id and ministry_id = v_m) then
    raise exception 'Group not found';
  end if;
  update user_roles set group_id = p_group_id where id = p_role_id and ministry_id = v_m;
  if v_old is not null and v_old is distinct from p_group_id then
    update members set assigned_servant_id = null, is_new_assignment = false
    where ministry_id = v_m and group_id = v_old and assigned_servant_id = v_user;
  end if;
end
$$;

-- No role grant may point at a hidden group, whoever writes it (Access
-- Maintenance writes user_roles directly).
create or replace function user_roles_no_hidden_group()
returns trigger language plpgsql security definer as $$
begin
  if new.group_id is not null and exists (select 1 from groups where id = new.group_id and kind <> 'regular') then
    raise exception 'Roles can''t be given on a hidden group (pre-entry or hand-over)';
  end if;
  return new;
end
$$;
create trigger trg_user_roles_no_hidden_group before insert or update of group_id on user_roles
  for each row execute function user_roles_no_hidden_group();

-- 8. Console: new ministries get a hand-over group too ---------------------

create or replace function apply_ministry_settings(p_ministry_id text, p_settings jsonb)
returns void language plpgsql security definer as $$
declare
  v jsonb := coalesce(p_settings, '{}'::jsonb) - 'ministry_id' - 'id' - 'updated_at' - 'app_version';
begin
  if not is_church_admin() then raise exception 'Church Admins only'; end if;
  update app_settings s set
    (app_title_long, app_title_short, app_subtitle, logo_url, theme_color, theme_color_light, theme_color_dark,
     servants_qr_color, my_assigned_header_color, my_assigned_header_color_light, group_label, member_label,
     group_name_template, same_day_cutoff_time, timezone, service_weekday, youth_attendance_window_weeks,
     servant_attendance_window_weeks, birthday_window_days_before, birthday_window_days_after, university_label,
     program_label, proximity_enabled, show_proximity_on_attendance, actions_needed_lookback_months,
     ladder_position_label, sub_coordinator_auto_servant, level_number_offset, terminal_name_pattern)
  = (select r.app_title_long, r.app_title_short, r.app_subtitle, r.logo_url, r.theme_color, r.theme_color_light, r.theme_color_dark,
            r.servants_qr_color, r.my_assigned_header_color, r.my_assigned_header_color_light, r.group_label, r.member_label,
            r.group_name_template, r.same_day_cutoff_time, r.timezone, r.service_weekday, r.youth_attendance_window_weeks,
            r.servant_attendance_window_weeks, r.birthday_window_days_before, r.birthday_window_days_after, r.university_label,
            r.program_label, r.proximity_enabled, r.show_proximity_on_attendance, r.actions_needed_lookback_months,
            r.ladder_position_label, r.sub_coordinator_auto_servant, r.level_number_offset, r.terminal_name_pattern
     from jsonb_populate_record(s, v) r)
  where s.ministry_id = p_ministry_id;
  if not found then raise exception 'Ministry % not found', p_ministry_id; end if;
end
$$;

drop function create_ministry(text, text, text[], text[], text, jsonb, text);
create function create_ministry(
  p_id text, p_name text, p_addresses text[], p_admin_emails text[], p_pre_entry_group_name text,
  p_settings jsonb default '{}'::jsonb, p_copy_from text default null, p_terminal_group_name text default null)
returns void language plpgsql security definer as $$
declare
  v_email text;
  v_user record;
  v_group_id uuid;
  v_host text;
  v_terminal text := coalesce(nullif(trim(p_terminal_group_name), ''), 'Transitioning');
begin
  if not is_church_admin() then raise exception 'Church Admins only'; end if;
  if p_id is null or p_id !~ '^[A-Z]{3}$' then raise exception 'The ministry code must be exactly 3 capital letters'; end if;
  if exists (select 1 from ministries where id = p_id) then raise exception 'The code % is already used', p_id; end if;
  if nullif(trim(p_name), '') is null then raise exception 'Name is required'; end if;
  if nullif(trim(p_pre_entry_group_name), '') is null then raise exception 'A name for the first (pre-entry) group is required'; end if;
  if lower(trim(p_pre_entry_group_name)) = lower(v_terminal) then
    raise exception 'The pre-entry and hand-over groups need different names';
  end if;
  if coalesce(array_length(p_admin_emails, 1), 0) not between 1 and 2 then raise exception 'Give 1 or 2 first Admins'; end if;
  if p_copy_from is not null and not exists (select 1 from ministries where id = p_copy_from) then
    raise exception 'Ministry % to copy from was not found', p_copy_from;
  end if;

  insert into ministries (id, name, display_order)
  values (p_id, trim(p_name), (select coalesce(max(display_order), 0) + 1 from ministries));

  insert into app_settings (ministry_id, app_title_long, app_title_short)
  values (p_id, trim(p_name), trim(p_name));
  perform apply_ministry_settings(p_id, p_settings);

  insert into audit_config (ministry_id, action_type, enabled, description)
  select p_id, t, true,
         (select c.description from audit_config c where c.ministry_id = coalesce(p_copy_from, 'SAY') and c.action_type = t)
  from unnest(enum_range(null::audit_action_type)) t;

  insert into actions_needed_config (ministry_id, proximity, min_presence_count, min_absence_weeks, min_outreach_weeks)
  values (p_id, 'Local', 0, 3, 4), (p_id, 'Regional', 0, 3, 4), (p_id, 'Abroad', 0, 6, 4), (p_id, 'Unknown', 0, 3, 4);

  -- Pre-entry (intake only, QR switched off) and hand-over (check-in, on).
  insert into groups (ministry_id, kind, cohort_year, ladder_position, name, display_order, qr_color, qr_active)
  values (p_id, 'pre_entry', null, 0, trim(p_pre_entry_group_name), 1, pick_group_color(p_id), false)
  returning id into v_group_id;
  insert into qr_codes (ministry_id, group_id, label, image_path, flow_type)
  values (p_id, v_group_id, trim(p_pre_entry_group_name), '', 'intake_only');
  insert into groups (ministry_id, kind, cohort_year, ladder_position, name, display_order, qr_color, qr_active)
  values (p_id, 'terminal', null, 1, v_terminal, 2, pick_group_color(p_id), true)
  returning id into v_group_id;
  insert into qr_codes (ministry_id, group_id, label, image_path, flow_type)
  values (p_id, v_group_id, v_terminal, '', 'check_in_and_intake');
  insert into qr_codes (ministry_id, group_id, label, image_path)
  values (p_id, null, trim(p_name) || ' Servants', '');

  foreach v_host in array coalesce(p_addresses, '{}') loop
    insert into ministry_addresses (host, ministry_id, kind) values (lower(trim(v_host)), p_id, 'ministry');
  end loop;

  foreach v_email in array p_admin_emails loop
    select u.id, u.email, u.raw_user_meta_data as meta into v_user
    from auth.users u where lower(u.email) = lower(trim(v_email)) limit 1;
    if v_user.id is null then
      raise exception 'No account for % -- ask them to sign in once first', v_email;
    end if;
    insert into profiles (ministry_id, id, full_name, email)
    values (p_id, v_user.id, coalesce(v_user.meta ->> 'full_name', v_user.meta ->> 'name', v_user.email), v_user.email)
    on conflict (ministry_id, id) do nothing;
    insert into user_roles (ministry_id, user_id, role, group_id) values (p_id, v_user.id, 'admin', null)
    on conflict do nothing;
  end loop;

  -- D4: copies, never shared.
  if p_copy_from is not null then
    insert into verses (ministry_id, text, reference, is_active)
    select p_id, text, reference, is_active from verses where ministry_id = p_copy_from;
    insert into holiday_rules (ministry_id, title, basis, start_month, start_day, start_offset, duration_days, is_active, created_by)
    select p_id, title, basis, start_month, start_day, start_offset, duration_days, is_active, null
    from holiday_rules where ministry_id = p_copy_from;
  end if;
end
$$;

-- 9. Public check-in: switches (D5) and shared codes (D13, Q11) --------------

create or replace function checkin_resolve(p_token uuid)
returns table(r_ministry_id text, r_group_id uuid, r_flow_type qr_flow_type, r_label text)
language plpgsql stable security definer as $$
declare
  v_active boolean;
  v_code_active boolean;
begin
  select q.ministry_id, q.group_id, q.flow_type, q.label, mi.is_active, coalesce(g.qr_active and not g.is_archived, true)
    into r_ministry_id, r_group_id, r_flow_type, r_label, v_active, v_code_active
  from qr_codes q
  join ministries mi on mi.id = q.ministry_id
  left join groups g on g.id = q.group_id
  where q.check_in_token = p_token;
  if r_ministry_id is null then
    raise exception 'Invalid check-in code';
  end if;
  if not v_active then
    raise exception 'This check-in code is no longer active';
  end if;
  if not v_code_active then
    raise exception 'This check-in code isn''t active';
  end if;
  return next;
end
$$;

-- The groups a code serves: its own group plus every group sharing it,
-- leaving out any switched off.
create or replace function checkin_served_groups(p_m text, p_owner uuid)
returns uuid[] language sql stable security definer as $$
  select coalesce(array_agg(g.id), '{}'::uuid[]) from groups g
  where g.ministry_id = p_m and not g.is_archived and g.qr_active
    and (g.id = p_owner or g.check_in_code_group_id = p_owner);
$$;

-- Q11: where a new sign-up through a shared code goes, by birth year.
-- Born in a sharing group's cohort year -> that group; earlier than every
-- sharing regular group -> the hand-over group; later -> the youngest; no
-- date, or a year after the pre-entry group's -> the oldest regular group.
create or replace function checkin_place_member(p_m text, p_owner uuid, p_dob date)
returns uuid language plpgsql stable security definer as $$
declare
  v_served uuid[] := checkin_served_groups(p_m, p_owner);
  v_y integer := extract(year from p_dob)::integer;
  v_pre_year integer;
  v_min integer;
  v_max integer;
  v_id uuid;
begin
  if cardinality(v_served) <= 1 then return p_owner; end if;
  select cohort_year into v_pre_year from groups where ministry_id = p_m and kind = 'pre_entry' and not is_archived;
  select min(cohort_year), max(cohort_year) into v_min, v_max
  from groups where id = any(v_served) and kind = 'regular' and cohort_year is not null;
  if v_min is null then return p_owner; end if;

  if v_y is null or (v_pre_year is not null and v_y > v_pre_year) then
    select id into v_id from groups where id = any(v_served) and kind = 'regular' and cohort_year = v_min
    order by display_order limit 1;
    return v_id;
  end if;
  select id into v_id from groups where id = any(v_served) and kind = 'regular' and cohort_year = v_y
  order by display_order limit 1;
  if v_id is not null then return v_id; end if;
  if v_y < v_min then
    select id into v_id from groups where id = any(v_served) and kind = 'terminal' order by display_order limit 1;
    if v_id is not null then return v_id; end if;
    select id into v_id from groups where id = any(v_served) and kind = 'regular' and cohort_year = v_min
    order by display_order limit 1;
    return v_id;
  end if;
  if v_y > v_max then
    select id into v_id from groups where id = any(v_served) and kind = 'regular' and cohort_year = v_max
    order by display_order limit 1;
    return v_id;
  end if;
  return p_owner;
end
$$;

create or replace function checkin_list_members(p_token uuid)
returns table(member_id uuid, full_name text)
language plpgsql security definer as $$
declare
  v_m text; v_group_id uuid; v_flow qr_flow_type;
begin
  select r_ministry_id, r_group_id, r_flow_type into v_m, v_group_id, v_flow from checkin_resolve(p_token);
  if v_group_id is null then raise exception 'Invalid check-in code'; end if;
  if v_flow <> 'check_in_and_intake' then raise exception 'This code does not support attendance check-in'; end if;
  return query
    select m.id, m.full_name from members m
    where m.ministry_id = v_m and m.group_id = any(checkin_served_groups(v_m, v_group_id)) and m.status = 'active'
    order by m.full_name;
end
$$;

create or replace function checkin_mark_attendance(p_token uuid, p_member_id uuid)
returns table(attendance_recorded boolean, newly_created boolean, missing_phone boolean, missing_email boolean,
              missing_university boolean, missing_program boolean, missing_dob boolean, missing_father_of_confession boolean)
language plpgsql security definer as $$
declare
  v_m text; v_group_id uuid; v_flow qr_flow_type; v_inserted_id uuid; v_member members%rowtype;
begin
  select r_ministry_id, r_group_id, r_flow_type into v_m, v_group_id, v_flow from checkin_resolve(p_token);
  if v_group_id is null then raise exception 'Invalid check-in code'; end if;
  if v_flow <> 'check_in_and_intake' then raise exception 'This code does not support attendance check-in'; end if;

  select * into v_member from members where id = p_member_id and ministry_id = v_m and status = 'active';
  if v_member.id is null or not (v_member.group_id = any(checkin_served_groups(v_m, v_group_id))) then
    raise exception 'Member does not belong to this group';
  end if;

  if not is_service_day(v_m) then
    return query select false, false,
      (v_member.phone is null or trim(v_member.phone) = ''), (v_member.email is null or trim(v_member.email) = ''),
      (v_member.university_id is null), (v_member.program_of_study is null or trim(v_member.program_of_study) = ''),
      (v_member.date_of_birth is null), (v_member.father_of_confession is null or trim(v_member.father_of_confession) = '');
    return;
  end if;

  insert into attendance_records (ministry_id, attendee_type, member_id, service_date, is_visitor_at_time)
  values (v_m, 'member', p_member_id, checkin_today(v_m), coalesce(v_member.is_visitor, false))
  on conflict (member_id, service_date) do nothing
  returning id into v_inserted_id;

  return query select true, (v_inserted_id is not null),
    (v_member.phone is null or trim(v_member.phone) = ''), (v_member.email is null or trim(v_member.email) = ''),
    (v_member.university_id is null), (v_member.program_of_study is null or trim(v_member.program_of_study) = ''),
    (v_member.date_of_birth is null), (v_member.father_of_confession is null or trim(v_member.father_of_confession) = '');
end
$$;

create or replace function checkin_fill_missing_member_fields(
  p_token uuid, p_member_id uuid, p_phone text default null, p_email text default null,
  p_university_id uuid default null, p_program_of_study text default null,
  p_date_of_birth date default null, p_father_of_confession text default null)
returns void language plpgsql security definer as $$
declare
  v_m text; v_group_id uuid; v_member_group uuid;
begin
  select r_ministry_id, r_group_id into v_m, v_group_id from checkin_resolve(p_token);
  if v_group_id is null then raise exception 'Invalid check-in code'; end if;

  select group_id into v_member_group from members where id = p_member_id and ministry_id = v_m and status = 'active';
  if v_member_group is null or not (v_member_group = any(checkin_served_groups(v_m, v_group_id))) then
    raise exception 'Member does not belong to this group';
  end if;
  if p_university_id is not null and not exists (select 1 from universities where id = p_university_id and ministry_id = v_m) then
    raise exception 'Unknown school';
  end if;

  update members set
    phone = case when phone is null or trim(phone) = '' then nullif(trim(p_phone), '') else phone end,
    email = case when email is null or trim(email) = '' then nullif(trim(p_email), '') else email end,
    university_id = coalesce(university_id, p_university_id),
    program_of_study = case when program_of_study is null or trim(program_of_study) = '' then nullif(trim(p_program_of_study), '') else program_of_study end,
    date_of_birth = coalesce(date_of_birth, p_date_of_birth),
    father_of_confession = case when father_of_confession is null or trim(father_of_confession) = '' then nullif(trim(p_father_of_confession), '') else father_of_confession end
  where id = p_member_id and ministry_id = v_m;
end
$$;

create or replace function checkin_find_possible_duplicate_member(
  p_token uuid, p_full_name text, p_phone text, p_email text, p_university_id uuid default null,
  p_program_of_study text default null, p_date_of_birth date default null, p_gender text default null)
returns table(member_id uuid, group_name text, same_group boolean, name_matches boolean, phone_matches boolean,
              email_matches boolean, university_matches boolean, program_matches boolean, dob_matches boolean, gender_matches boolean)
language plpgsql security definer as $$
declare
  v_m text; v_group_id uuid; v_flow qr_flow_type; v_served uuid[];
begin
  select r_ministry_id, r_group_id, r_flow_type into v_m, v_group_id, v_flow from checkin_resolve(p_token);
  if v_group_id is null then raise exception 'Invalid check-in code'; end if;
  if v_flow <> 'check_in_and_intake' then raise exception 'This code does not support attendance check-in'; end if;
  v_served := checkin_served_groups(v_m, v_group_id);

  -- Searches ONLY the QR code's ministry (plan §2.5 #12).
  return query
  select m.id, g.name, (m.group_id = any(v_served)),
    (lower(trim(m.full_name)) = lower(trim(p_full_name))),
    (m.phone = p_phone),
    (lower(m.email) = lower(p_email)),
    case when p_university_id is null then null when m.university_id is null then false else (m.university_id = p_university_id) end,
    case when p_program_of_study is null or trim(p_program_of_study) = '' then null
         when m.program_of_study is null or trim(m.program_of_study) = '' then false
         else (lower(trim(m.program_of_study)) = lower(trim(p_program_of_study))) end,
    case when p_date_of_birth is null then null when m.date_of_birth is null then false else (m.date_of_birth = p_date_of_birth) end,
    case when p_gender is null or trim(p_gender) = '' then null when m.gender is null then false else (lower(m.gender) = lower(p_gender)) end
  from members m
  join groups g on g.id = m.group_id
  where m.ministry_id = v_m
    and m.status = 'active'
    and (lower(trim(m.full_name)) = lower(trim(p_full_name)) or m.phone = p_phone or lower(m.email) = lower(p_email))
  order by
    (lower(trim(m.full_name)) = lower(trim(p_full_name)))::int desc,
    ((lower(trim(m.full_name)) = lower(trim(p_full_name)))::int + (m.phone = p_phone)::int + (lower(m.email) = lower(p_email))::int) desc,
    (lower(m.email) = lower(p_email))::int desc,
    (m.phone = p_phone)::int desc
  limit 1;
end
$$;

-- "Is this you?": a move never happens between groups sharing the code; a
-- person from another group is placed by birth year among them (Q11).
create or replace function checkin_resolve_duplicate_member(
  p_token uuid, p_member_id uuid, p_move_to_scanned_group boolean,
  p_phone text default null, p_update_phone boolean default false,
  p_date_of_birth date default null, p_update_dob boolean default false,
  p_gender text default null, p_update_gender boolean default false,
  p_university_id uuid default null, p_update_university boolean default false,
  p_program_of_study text default null, p_update_program boolean default false,
  p_home_address text default null, p_update_home_address boolean default false,
  p_father_of_confession text default null, p_update_father_of_confession boolean default false)
returns table(attendance_recorded boolean, newly_created boolean)
language plpgsql security definer as $$
declare
  v_m text; v_group_id uuid; v_flow qr_flow_type; v_is_visitor boolean; v_inserted_id uuid;
begin
  select r_ministry_id, r_group_id, r_flow_type into v_m, v_group_id, v_flow from checkin_resolve(p_token);
  if v_group_id is null then raise exception 'Invalid check-in code'; end if;
  if v_flow <> 'check_in_and_intake' then raise exception 'This code does not support attendance check-in'; end if;
  -- Only a member of the QR code's own ministry (plan §2.5 #13).
  if not exists (select 1 from members where id = p_member_id and ministry_id = v_m and status = 'active') then
    raise exception 'Member not found';
  end if;
  if p_update_university and p_university_id is not null
     and not exists (select 1 from universities where id = p_university_id and ministry_id = v_m) then
    raise exception 'Unknown school';
  end if;

  update members set
    phone = case when p_update_phone then p_phone else phone end,
    date_of_birth = case when p_update_dob then p_date_of_birth else date_of_birth end,
    gender = case when p_update_gender then p_gender else gender end,
    university_id = case when p_update_university then p_university_id else university_id end,
    program_of_study = case when p_update_program then p_program_of_study else program_of_study end,
    home_address = case when p_update_home_address then p_home_address else home_address end,
    father_of_confession = case when p_update_father_of_confession then p_father_of_confession else father_of_confession end,
    group_id = case when p_move_to_scanned_group and not (group_id = any(checkin_served_groups(v_m, v_group_id)))
                    then checkin_place_member(v_m, v_group_id,
                           case when p_update_dob then p_date_of_birth else date_of_birth end)
                    else group_id end
  where id = p_member_id and ministry_id = v_m
  returning is_visitor into v_is_visitor;

  if not is_service_day(v_m) then
    return query select false, false;
    return;
  end if;

  insert into attendance_records (ministry_id, attendee_type, member_id, service_date, is_visitor_at_time)
  values (v_m, 'member', p_member_id, checkin_today(v_m), coalesce(v_is_visitor, false))
  on conflict (member_id, service_date) do nothing
  returning id into v_inserted_id;

  return query select true, (v_inserted_id is not null);
end
$$;

create or replace function checkin_submit_new_member(
  p_token uuid, p_full_name text, p_phone text default null, p_email text default null,
  p_university_id uuid default null, p_program_of_study text default null, p_date_of_birth date default null,
  p_father_of_confession text default null, p_home_address text default null, p_gender text default null,
  p_comments text default null)
returns table(member_id uuid, attendance_recorded boolean)
language plpgsql security definer as $$
#variable_conflict use_column
declare
  v_m text; v_group_id uuid; v_flow qr_flow_type; v_new_member_id uuid; v_recorded boolean := false;
begin
  select r_ministry_id, r_group_id, r_flow_type into v_m, v_group_id, v_flow from checkin_resolve(p_token);
  if v_group_id is null then raise exception 'Invalid check-in code'; end if;
  if p_university_id is not null and not exists (select 1 from universities where id = p_university_id and ministry_id = v_m) then
    raise exception 'Unknown school';
  end if;

  insert into members (ministry_id, group_id, full_name, phone, email, university_id, program_of_study, date_of_birth,
                       father_of_confession, home_address, gender, registration_comments)
  values (v_m, checkin_place_member(v_m, v_group_id, p_date_of_birth), p_full_name, p_phone, p_email, p_university_id,
          p_program_of_study, p_date_of_birth, p_father_of_confession, p_home_address, p_gender, p_comments)
  returning id into v_new_member_id;

  if v_flow = 'check_in_and_intake' and is_service_day(v_m) then
    insert into attendance_records (ministry_id, attendee_type, member_id, service_date)
    values (v_m, 'member', v_new_member_id, checkin_today(v_m))
    on conflict (member_id, service_date) do nothing;
    v_recorded := true;
  end if;

  return query select v_new_member_id, v_recorded;
end
$$;

create or replace function checkin_undo_attendance(p_token uuid, p_member_id uuid)
returns void language plpgsql security definer as $$
declare
  v_m text; v_group_id uuid; v_member_group uuid;
begin
  select r_ministry_id, r_group_id into v_m, v_group_id from checkin_resolve(p_token);
  if v_group_id is null then raise exception 'Invalid check-in code'; end if;
  select group_id into v_member_group from members where id = p_member_id and ministry_id = v_m;
  if v_member_group is null or not (v_member_group = any(checkin_served_groups(v_m, v_group_id))) then
    raise exception 'Member does not belong to this group';
  end if;

  delete from attendance_records
  where ministry_id = v_m and member_id = p_member_id and attendee_type = 'member'
    and service_date = checkin_today(v_m) and created_at > now() - interval '2 minutes';
end
$$;

-- 10. Security rules (RLS): hidden groups' people are Admin-only -----------
-- General Coordinators reach every REGULAR group through
-- accessible_group_ids(); only Admins/the Church Admin reach hidden ones.

drop policy groups_select on groups;
create policy groups_select on groups for select
  using (ministry_id = (select current_ministry_id()) and (
    (kind <> 'regular' and (select is_admin()))
    or (kind = 'regular' and ((select is_app_user()) or has_group_access(id)))));

drop policy members_select on members;
create policy members_select on members for select
  using (ministry_id = (select current_ministry_id())
         and ((select is_admin()) or group_id = any ((select accessible_group_ids(true))::uuid[])));
drop policy members_insert on members;
create policy members_insert on members for insert
  with check (ministry_id = (select current_ministry_id())
              and ((select is_admin()) or group_id = any ((select accessible_group_ids(false))::uuid[])));
-- The check also applies to the NEW group, so nobody but an Admin can move a
-- youth into a hidden group.
drop policy members_update on members;
create policy members_update on members for update
  using (ministry_id = (select current_ministry_id())
         and ((select is_admin()) or group_id = any ((select accessible_group_ids(false))::uuid[])))
  with check (ministry_id = (select current_ministry_id())
              and ((select is_admin()) or group_id = any ((select accessible_group_ids(false))::uuid[])));
drop policy members_delete on members;
create policy members_delete on members for delete
  using (ministry_id = (select current_ministry_id())
         and ((select is_admin())
              or ((select is_admin_or_general_coordinator()) and group_id = any ((select accessible_group_ids(false))::uuid[]))));

drop policy attendance_select on attendance_records;
create policy attendance_select on attendance_records for select
  using (ministry_id = (select current_ministry_id()) and (
    (attendee_type = 'member' and ((select is_admin())
        or member_id in (select m.id from members m where m.group_id = any ((select accessible_group_ids(true))::uuid[]))))
    or (attendee_type = 'servant' and (select is_app_user()))));
drop policy attendance_insert on attendance_records;
create policy attendance_insert on attendance_records for insert
  with check (ministry_id = (select current_ministry_id()) and (
    (attendee_type = 'member' and ((select is_admin())
        or member_id in (select m.id from members m where m.group_id = any ((select accessible_group_ids(false))::uuid[]))))
    or (attendee_type = 'servant' and (select is_coordinator()))));
drop policy attendance_delete on attendance_records;
create policy attendance_delete on attendance_records for delete
  using (ministry_id = (select current_ministry_id()) and (
    (attendee_type = 'member' and ((select is_admin())
        or member_id in (select m.id from members m where m.group_id = any ((select accessible_group_ids(false))::uuid[]))))
    or (attendee_type = 'servant' and (select is_coordinator()))));

drop policy outreach_select on outreach_entries;
create policy outreach_select on outreach_entries for select
  using (ministry_id = (select current_ministry_id()) and ((select is_admin())
         or member_id in (select m.id from members m where m.group_id = any ((select accessible_group_ids(true))::uuid[]))));
drop policy outreach_insert on outreach_entries;
create policy outreach_insert on outreach_entries for insert
  with check (ministry_id = (select current_ministry_id()) and ((select is_admin())
              or member_id in (select m.id from members m where m.group_id = any ((select accessible_group_ids(false))::uuid[]))));

-- The Servants code and regular groups' codes: Admin or General
-- Coordinator; hidden groups' codes: Admin only.
drop policy qr_codes_write on qr_codes;
create policy qr_codes_write on qr_codes for all
  using (ministry_id = (select current_ministry_id())
         and ((select is_admin())
              or ((select is_admin_or_general_coordinator())
                  and (group_id is null or group_id = any ((select accessible_group_ids(false))::uuid[])))))
  with check (ministry_id = (select current_ministry_id())
              and ((select is_admin())
                   or ((select is_admin_or_general_coordinator())
                       and (group_id is null or group_id = any ((select accessible_group_ids(false))::uuid[])))));

-- 11. Privileges and pinned search_path -----------------------------------

do $$
declare
  f record;
  v_schema text := current_schema();
  v_admin text[] := array['add_group', 'move_group', 'set_group_level', 'set_group_name_pattern', 'set_group_qr_active',
                          'set_group_check_in_code', 'preview_group_transition', 'run_group_transition',
                          'archive_terminal_members', 'get_qr_codes_with_groups', 'create_ministry'];
  v_internal text[] := array['render_group_name', 'pick_group_color', 'assert_group_name_free', 'tidy_group_order',
                             'normalize_group_levels', 'transfer_check_in_code', 'group_transition_core',
                             'user_roles_no_hidden_group', 'checkin_served_groups', 'checkin_place_member'];
begin
  for f in
    select p.oid::regprocedure as sig, p.proname, p.proconfig
    from pg_proc p where p.pronamespace = v_schema::regnamespace
  loop
    if f.proname = any (v_admin || v_internal) then
      execute format('revoke all on function %s from public, anon, authenticated', f.sig);
      execute format('grant execute on function %s to service_role', f.sig);
      if f.proname = any (v_admin) then
        execute format('grant execute on function %s to authenticated', f.sig);
      end if;
    end if;
    -- create or replace drops a function's pinned search_path: pin again.
    if f.proconfig is null then
      execute format('alter function %s set search_path = %I, public, pg_temp', f.sig, v_schema);
    end if;
  end loop;
end
$$;

-- 12. Post-checks (abort the whole transaction on any surprise) ------------

do $$
declare
  v_bad text;
  b record;
begin
  -- Every ministry: one pre-entry, at least one hand-over group at N+1,
  -- regular levels 1..N with no gaps.
  select string_agg(m.id, ', ') into v_bad from ministries m
  where (select count(*) from groups where ministry_id = m.id and kind = 'pre_entry' and not is_archived) <> 1
     or (select count(*) from groups where ministry_id = m.id and kind = 'terminal' and not is_archived) < 1
     or (select count(distinct ladder_position) from groups where ministry_id = m.id and kind = 'regular' and not is_archived)
        <> coalesce((select max(ladder_position) from groups where ministry_id = m.id and kind = 'regular' and not is_archived), 0)
     or exists (select 1 from groups t where t.ministry_id = m.id and t.kind = 'terminal' and not t.is_archived
                and t.ladder_position <> coalesce((select max(ladder_position) from groups
                                                   where ministry_id = m.id and kind = 'regular' and not is_archived), 0) + 1)
     or exists (select 1 from groups a, groups z where a.ministry_id = m.id and z.ministry_id = m.id
                and not a.is_archived and not z.is_archived and a.kind = 'pre_entry' and z.kind <> 'pre_entry'
                and a.display_order > z.display_order)
     or exists (select 1 from groups a, groups z where a.ministry_id = m.id and z.ministry_id = m.id
                and not a.is_archived and not z.is_archived and a.kind = 'terminal' and z.kind = 'regular'
                and a.display_order < z.display_order);
  if v_bad is not null then raise exception 'Ladder check failed for: %', v_bad; end if;

  -- Nothing lost or moved.
  select * into b from _ladder_before;
  if b.members <> (select count(*) from members) or b.attendance <> (select count(*) from attendance_records)
     or b.outreach <> (select count(*) from outreach_entries) or b.grants <> (select count(*) from user_roles)
     or b.qr_codes + (select count(*) from ministries) <> (select count(*) from qr_codes) then
    raise exception 'Row counts changed unexpectedly';
  end if;
  execute format('select string_agg(o.name, '', '') from %I.ladder_0069_groups o join groups g on g.id = o.id
                  where g.name <> o.name or g.qr_color is distinct from o.qr_color or g.is_archived <> o.is_archived
                     or g.ladder_position <> o.ladder_position or g.cohort_year is distinct from o.cohort_year
                     or (select array_agg(q.check_in_token order by q.check_in_token) from qr_codes q where q.group_id = g.id)
                        is distinct from o.tokens', current_schema() || '_premm_backup') into v_bad;
  if v_bad is not null then raise exception 'Existing groups changed: %', v_bad; end if;

  -- No grant on a hidden group.
  select string_agg(g.name, ', ') into v_bad from user_roles ur join groups g on g.id = ur.group_id where g.kind <> 'regular';
  if v_bad is not null then raise exception 'Grants on hidden groups: %', v_bad; end if;

  -- Every rule still names the ministry; every definer function pinned.
  select string_agg(p.tablename || '.' || p.policyname, ', ') into v_bad
  from pg_policies p
  where p.schemaname = current_schema() and p.tablename not in ('app_releases')
    and coalesce(p.qual, '') || coalesce(p.with_check, '') not like '%current_ministry_id()%';
  if v_bad is not null then raise exception 'Rules without the ministry condition: %', v_bad; end if;
  select string_agg(p.oid::regprocedure::text, ', ') into v_bad
  from pg_proc p where p.pronamespace = current_schema()::regnamespace and p.prosecdef and p.proconfig is null;
  if v_bad is not null then raise exception 'Definer functions without a pinned search_path: %', v_bad; end if;

  -- Not callable without signing in.
  select string_agg(p.proname, ', ') into v_bad
  from pg_proc p where p.pronamespace = current_schema()::regnamespace
    and p.proname in ('add_group', 'move_group', 'set_group_level', 'set_group_name_pattern', 'set_group_qr_active',
                      'set_group_check_in_code', 'preview_group_transition', 'run_group_transition',
                      'archive_terminal_members', 'group_transition_core', 'checkin_place_member', 'pick_group_color')
    and has_function_privilege('anon', p.oid, 'execute');
  if v_bad is not null then raise exception 'Callable by anon: %', v_bad; end if;
end
$$;

notify pgrst, 'reload schema';
