-- 0130_handover_group_open.sql -- A MINISTRY MAY LET ITS HAND-OVER GROUP WORK
-- LIKE ANY OTHER GROUP (owner-requested 21 Nov 2026).
-- Why: SAY's check-in poster shares one code across Yr 5, Yr 6 and the
-- hand-over group, so a late sign-up born 2002 or earlier lands in the
-- hand-over group, which only Admins can see. SAY keeps those youths there
-- for now and wants its Coordinators and Servants to see them, take their
-- attendance, record outreach and move youths in and out.
-- What this adds:
-- * Ministry Settings -> "Hand-over group" (app_settings.handover_group_active),
--   OFF for every ministry. While it's off nothing changes anywhere.
-- * While it's on, the hand-over group counts as a regular group wherever a
--   group's access is decided: who can see it and its youths, role grants on
--   it (an Admin or General Coordinator gives them on Servant Assignments, as
--   for any group), its photos, its alerts and its calendar audience.
--   Moving a youth in or out still needs a role on BOTH groups, as always.
-- * While it's on, the year-end Group Transition is no longer blocked by
--   youths left in the hand-over group, and nothing is archived: they stay.
-- * The setting can't be switched off while anyone still holds a role on the
--   hand-over group.
-- The group's kind stays "terminal", so the ladder, check-in placement and the
-- transition keep working as before. Patched with the 0129 method: each
-- function is read, changed in one named place and rewritten; it stops if
-- the text isn't what's expected.
-- Run once per environment, QA first, together with the app code:
--     begin; set local search_path to qa; \i 0130_handover_group_open.sql; commit;
-- Undo with 0130_down_handover_group_open.sql. Writes no audit entries.

do $$
begin
  if current_schema() not in ('qa', 'prod') then
    raise exception 'Run with search_path set to qa or prod (got %)', current_schema();
  end if;
end
$$;

-- ---------------------------------------------------------------- setting
alter table app_settings add column handover_group_active boolean not null default false;

-- Can't be switched off while someone still holds a role on the hand-over
-- group (the role rule below would then leave those grants pointing at a
-- hidden group).
create function app_settings_handover_off_guard()
returns trigger language plpgsql security definer as $$
begin
  if old.handover_group_active and not new.handover_group_active and exists (
       select 1 from user_roles ur join groups g on g.id = ur.group_id
       where ur.ministry_id = new.ministry_id and g.kind = 'terminal') then
    raise exception 'Remove everyone''s roles on the hand-over group before switching this off.';
  end if;
  return new;
end
$$;
create trigger trg_app_settings_handover_off before update of handover_group_active on app_settings
  for each row execute function app_settings_handover_off_guard();

-- --------------------------------------------------------------- helpers
create function handover_open(p_ministry text)
returns boolean language sql stable security definer as $$
  select coalesce((select handover_group_active from app_settings where ministry_id = p_ministry), false);
$$;

-- True for a regular group, and for the hand-over group while its ministry
-- has switched it on.
create function group_counts_as_regular(p_kind group_kind, p_ministry text)
returns boolean language sql stable security definer as $$
  select p_kind = 'regular' or (p_kind = 'terminal' and handover_open(p_ministry));
$$;

do $$
declare f text;
begin
  foreach f in array array['app_settings_handover_off_guard()', 'handover_open(text)', 'group_counts_as_regular(group_kind, text)'] loop
    execute format('alter function %s set search_path = %I, public, pg_temp', f, current_schema());
    execute format('revoke all on function %s from public, anon, authenticated, service_role', f);
  end loop;
  -- Used inside security rules, which run as the signed-in person.
  foreach f in array array['handover_open(text)', 'group_counts_as_regular(group_kind, text)'] loop
    execute format('grant execute on function %s to authenticated, service_role', f);
  end loop;
end
$$;

-- ------------------------------------------------- the access functions
do $$
declare
  s text := current_schema();
  v text;
  r record;
  n int;
begin
  for r in
    select * from (values
      -- who can reach which groups (every security rule reads this)
      ('accessible_group_ids(boolean)',
       'g.kind = ''regular'' and (f.gc',
       'group_counts_as_regular(g.kind, g.ministry_id) and (f.gc', 1),
      ('has_group_access(uuid, uuid)',
       'or (g.kind = ''regular''',
       'or (group_counts_as_regular(g.kind, g.ministry_id)', 1),
      ('has_readonly_or_full_group_access(uuid, uuid)',
       'and g.kind = ''regular''',
       'and group_counts_as_regular(g.kind, g.ministry_id)', 1),
      -- role grants on the group
      ('user_roles_no_hidden_group()',
       'kind <> ''regular''',
       'not group_counts_as_regular(kind, ministry_id)', 1),
      -- names list, QR page, photos, calendar audience
      ('export_group_member_names(uuid)',
       'kind <> ''regular''',
       'not group_counts_as_regular(kind, ministry_id)', 1),
      ('get_qr_codes_with_groups()',
       'sg.kind = ''regular'' or is_admin()',
       'group_counts_as_regular(sg.kind, sg.ministry_id) or is_admin()', 1),
      ('storage_photo_read_allowed(text)',
       'g.kind = ''regular''',
       'group_counts_as_regular(g.kind, g.ministry_id)', 1),
      ('storage_photo_write_allowed(text, text, text)',
       'v_gkind = ''regular''',
       '(v_gkind = ''regular'' or (v_gkind = ''terminal'' and handover_open(v_m)))', 2),
      ('calendar_attendance_guard()',
       'g.kind::text = ''regular''',
       'group_counts_as_regular(g.kind, g.ministry_id)', 1),
      -- alerts and the team view leave the hand-over group out unless it is open
      ('notification_yellow(text)',
       'g.kind::text <> ''terminal''',
       '(g.kind::text <> ''terminal'' or handover_open(g.ministry_id))', 1),
      ('notify_servant_birthdays(text, date)',
       'gr.kind::text <> ''terminal''',
       '(gr.kind::text <> ''terminal'' or handover_open(gr.ministry_id))', 1),
      ('notify_tick()',
       'g.kind::text <> ''terminal''',
       '(g.kind::text <> ''terminal'' or handover_open(g.ministry_id))', 6),
      ('servant_team(text, uuid)',
       'gr.kind::text <> ''terminal''',
       '(gr.kind::text <> ''terminal'' or handover_open(gr.ministry_id))', 1),
      -- the year-end transition is not blocked by youths left in the hand-over group
      ('group_transition_core(integer, text, text[], text)',
       'if v_count > 0 then',
       'if v_count > 0 and not handover_open(v_m) then', 1)
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

-- Who can see which groups at all.
drop policy groups_select on groups;
create policy groups_select on groups for select
  using (ministry_id = (select current_ministry_id()) and (
    (not group_counts_as_regular(kind, ministry_id) and (select is_admin()))
    or (group_counts_as_regular(kind, ministry_id) and ((select is_app_user()) or has_group_access(id)))));
