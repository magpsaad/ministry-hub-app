-- 0073_down_group_gender_patron_saint.sql -- undoes 0073 (the gender and patron
-- saint fields go; {gender}/{patron_saint} are no longer filled in).
--     begin; set local search_path to qa; \i 0073_down_group_gender_patron_saint.sql; commit;

do $$
begin
  if current_schema() not in ('qa', 'prod') then
    raise exception 'Run with search_path set to qa or prod (got %)', current_schema();
  end if;
end
$$;

do $$
declare
  v_sig regprocedure := format('%I.group_transition_core(integer, text, text[], text)', current_schema())::regprocedure;
  v_def text := pg_get_functiondef(v_sig);
  v_new text := replace(v_def, 's.ladder_position_label, gender_label, patron_saint)', 's.ladder_position_label)');
begin
  if (length(v_def) - length(v_new)) <> 2 * length(', gender_label, patron_saint') then
    raise exception 'group_transition_core: expected to restore 2 name renderings';
  end if;
  execute v_new;
end
$$;

drop function if exists set_group_gender_saint(uuid, text, text);
drop function if exists render_group_name(text, integer, integer, integer, text, text, text);
create function render_group_name(p_pattern text, p_cohort_year integer, p_level integer, p_offset integer, p_label text)
returns text language sql immutable as $$
  select btrim(replace(replace(replace(replace(coalesce(p_pattern, ''),
           '{cohort_year}', coalesce(p_cohort_year::text, '')),
           '{level}', (coalesce(p_level, 0) + coalesce(p_offset, 0))::text),
           '{position_label}', (coalesce(p_level, 0) + coalesce(p_offset, 0))::text),
           '{label}', coalesce(p_label, '')), ' -');
$$;

do $$
begin
  execute format('alter function render_group_name(text, integer, integer, integer, text) set search_path = %I, public, pg_temp', current_schema());
  execute 'revoke all on function render_group_name(text, integer, integer, integer, text) from public, anon, authenticated';
  execute 'grant execute on function render_group_name(text, integer, integer, integer, text) to service_role';
end
$$;

alter table groups drop column if exists patron_saint;
alter table groups drop column if exists gender_label;
