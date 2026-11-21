-- 0130_down_handover_group_open.sql -- undo 0130 (QA first).
-- Refuses to run while anyone still holds a role on a hand-over group.
--     begin; set local search_path to qa; \i 0130_down_handover_group_open.sql; commit;

do $$
begin
  if current_schema() not in ('qa', 'prod') then
    raise exception 'Run with search_path set to qa or prod (got %)', current_schema();
  end if;
  if exists (select 1 from user_roles ur join groups g on g.id = ur.group_id where g.kind = 'terminal') then
    raise exception 'Remove the roles on the hand-over group(s) first';
  end if;
  if exists (select 1 from app_settings where handover_group_active) then
    raise exception 'Switch the hand-over group setting off in every ministry first';
  end if;
end
$$;

drop policy groups_select on groups;
create policy groups_select on groups for select
  using (ministry_id = (select current_ministry_id()) and (
    (kind <> 'regular' and (select is_admin()))
    or (kind = 'regular' and ((select is_app_user()) or has_group_access(id)))));

do $$
declare
  s text := current_schema();
  v text;
  r record;
  n int;
begin
  for r in
    select * from (values
      ('accessible_group_ids(boolean)',
       'group_counts_as_regular(g.kind, g.ministry_id) and (f.gc',
       'g.kind = ''regular'' and (f.gc', 1),
      ('has_group_access(uuid, uuid)',
       'or (group_counts_as_regular(g.kind, g.ministry_id)',
       'or (g.kind = ''regular''', 1),
      ('has_readonly_or_full_group_access(uuid, uuid)',
       'and group_counts_as_regular(g.kind, g.ministry_id)',
       'and g.kind = ''regular''', 1),
      ('user_roles_no_hidden_group()',
       'not group_counts_as_regular(kind, ministry_id)',
       'kind <> ''regular''', 1),
      ('export_group_member_names(uuid)',
       'not group_counts_as_regular(kind, ministry_id)',
       'kind <> ''regular''', 1),
      ('get_qr_codes_with_groups()',
       'group_counts_as_regular(sg.kind, sg.ministry_id) or is_admin()',
       'sg.kind = ''regular'' or is_admin()', 1),
      ('storage_photo_read_allowed(text)',
       'group_counts_as_regular(g.kind, g.ministry_id)',
       'g.kind = ''regular''', 1),
      ('storage_photo_write_allowed(text, text, text)',
       '(v_gkind = ''regular'' or (v_gkind = ''terminal'' and handover_open(v_m)))',
       'v_gkind = ''regular''', 2),
      ('calendar_attendance_guard()',
       'group_counts_as_regular(g.kind, g.ministry_id)',
       'g.kind::text = ''regular''', 1),
      ('notification_yellow(text)',
       '(g.kind::text <> ''terminal'' or handover_open(g.ministry_id))',
       'g.kind::text <> ''terminal''', 1),
      ('notify_servant_birthdays(text, date)',
       '(gr.kind::text <> ''terminal'' or handover_open(gr.ministry_id))',
       'gr.kind::text <> ''terminal''', 1),
      ('notify_tick()',
       '(g.kind::text <> ''terminal'' or handover_open(g.ministry_id))',
       'g.kind::text <> ''terminal''', 6),
      ('servant_team(text, uuid)',
       '(gr.kind::text <> ''terminal'' or handover_open(gr.ministry_id))',
       'gr.kind::text <> ''terminal''', 1),
      ('group_transition_core(integer, text, text[], text)',
       'if v_count > 0 and not handover_open(v_m) then',
       'if v_count > 0 then', 1)
    ) t(fn, a, b, expected)
  loop
    v := pg_get_functiondef(format('%I.%s', s, r.fn)::regprocedure);
    n := (length(v) - length(replace(v, r.a, ''))) / length(r.a);
    if n <> r.expected then
      raise exception '% has changed (found % of the expected % place(s)); patch it by hand', r.fn, n, r.expected;
    end if;
    execute replace(v, r.a, r.b);
  end loop;
end
$$;

drop trigger trg_app_settings_handover_off on app_settings;
drop function app_settings_handover_off_guard();
drop function group_counts_as_regular(group_kind, text);
drop function handover_open(text);
alter table app_settings drop column handover_group_active;
