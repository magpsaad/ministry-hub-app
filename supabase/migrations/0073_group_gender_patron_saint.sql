-- 0073_group_gender_patron_saint.sql -- {gender} AND {patron_saint} IN NAME PATTERNS
-- (owner-requested, 1 Oct 2026, for HSY's classes: "Gr{level} {gender} {patron_saint}").
-- Run once per environment, QA first:
--     begin; set local search_path to qa; \i 0073_group_gender_patron_saint.sql; commit;
-- Undo with 0073_down_group_gender_patron_saint.sql.
--
-- * groups get two optional fields, gender_label ("Girls") and patron_saint
--   ("St. Marina"), set by Admins with set_group_gender_saint().
-- * render_group_name() also fills in {gender} and {patron_saint} (empty when
--   the group has none) and squeezes the double space an empty one leaves.
-- * The Group Transition passes each class's own values when it renames
--   the classes (a two-call patch of group_transition_core, counted).
-- Nothing is renamed by this migration. Writes no audit entries.

do $$
begin
  if current_schema() not in ('qa', 'prod') then
    raise exception 'Run with search_path set to qa or prod (got %)', current_schema();
  end if;
end
$$;

alter table groups add column if not exists gender_label text;
alter table groups add column if not exists patron_saint text;

drop function if exists render_group_name(text, integer, integer, integer, text);
create function render_group_name(p_pattern text, p_cohort_year integer, p_level integer, p_offset integer, p_label text,
                                  p_gender text default null, p_patron_saint text default null)
returns text language sql immutable as $$
  select btrim(regexp_replace(
           replace(replace(replace(replace(replace(replace(coalesce(p_pattern, ''),
             '{cohort_year}', coalesce(p_cohort_year::text, '')),
             '{level}', (coalesce(p_level, 0) + coalesce(p_offset, 0))::text),
             '{position_label}', (coalesce(p_level, 0) + coalesce(p_offset, 0))::text),
             '{label}', coalesce(p_label, '')),
             '{gender}', coalesce(btrim(p_gender), '')),
             '{patron_saint}', coalesce(btrim(p_patron_saint), '')),
           '\s{2,}', ' ', 'g'), ' -');
$$;

create or replace function set_group_gender_saint(p_group_id uuid, p_gender text, p_patron_saint text)
returns void language plpgsql security definer as $$
declare
  v_m text := current_ministry_id();
begin
  if not is_admin_in(v_m) then raise exception 'Only Admins may change a group''s gender or patron saint'; end if;
  update groups set gender_label = nullif(btrim(p_gender), ''), patron_saint = nullif(btrim(p_patron_saint), '')
  where id = p_group_id and ministry_id = v_m and not is_archived;
  if not found then raise exception 'Group not found'; end if;
end
$$;

-- The transition renames classes from their own pattern: pass their gender
-- and patron saint too. Exactly two calls are expected.
do $$
declare
  v_sig regprocedure := format('%I.group_transition_core(integer, text, text[], text)', current_schema())::regprocedure;
  v_def text := pg_get_functiondef(v_sig);
  v_new text;
begin
  v_new := regexp_replace(v_def,
    'render_group_name\(name_pattern, cohort_year, ladder_position,(\s*)s\.level_number_offset, s\.ladder_position_label\)',
    'render_group_name(name_pattern, cohort_year, ladder_position,\1s.level_number_offset, s.ladder_position_label, gender_label, patron_saint)', 'g');
  if (length(v_new) - length(v_def)) <> 2 * length(', gender_label, patron_saint') then
    raise exception 'group_transition_core: expected to update 2 name renderings';
  end if;
  execute v_new;
end
$$;

-- Same pinning and access as before: render_group_name only for the
-- database's own functions; the setter for signed-in users (Admins, checked).
do $$
begin
  execute format('alter function render_group_name(text, integer, integer, integer, text, text, text) set search_path = %I, public, pg_temp', current_schema());
  execute 'revoke all on function render_group_name(text, integer, integer, integer, text, text, text) from public, anon, authenticated';
  execute 'grant execute on function render_group_name(text, integer, integer, integer, text, text, text) to service_role';
  execute format('alter function set_group_gender_saint(uuid, text, text) set search_path = %I, public, pg_temp', current_schema());
  execute 'revoke all on function set_group_gender_saint(uuid, text, text) from public, anon';
  execute 'grant execute on function set_group_gender_saint(uuid, text, text) to authenticated, service_role';
end
$$;
