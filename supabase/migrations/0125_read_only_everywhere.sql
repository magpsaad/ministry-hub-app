-- 0125_read_only_everywhere.sql -- READ-ONLY ACCESS TO EVERY GROUP AS ONE
-- GRANT (owner-approved 18 Oct 2026). Read-only access was one grant per
-- group (HSY: 12 lines for one person, and a new group was never covered).
-- A read_only grant with NO group now means "every regular group, now and
-- in future" -- like Admin/General Coordinator reach, but view-only (and
-- whatever the ministry's Read-only switches allow).
-- * accessible_group_ids(), has_readonly_or_full_group_access(): such a
--   grant reaches every regular group (same authenticator rule as a
--   per-group grant).
-- * storage_photo_read_allowed() / storage_photo_write_allowed(): youth
--   photos the same way (Read-only may add a missing photo if allowed).
-- * role_group_scope_check: a read_only grant may now have no group.
-- * read_only_everywhere_rule (trigger): giving the every-group grant
--   replaces the person's per-group read-only grants; nobody holds both.
-- * Existing full sets (read-only on every current group they don't
--   already serve, at least two) become one grant each.
-- Run once per environment, QA first:
--     begin; set local search_path to qa; \i 0125_read_only_everywhere.sql; commit;
-- Undo with 0125_down_read_only_everywhere.sql. Writes no audit entries.

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
      ('accessible_group_ids(boolean)',
       'ur.group_id = g.id',
       '(ur.group_id = g.id or (ur.role = ''read_only'' and ur.group_id is null))'),
      ('has_readonly_or_full_group_access(uuid, uuid)',
       'where ur.user_id = uid and ur.group_id = gid and ur.role = ''read_only''',
       'where ur.user_id = uid and ur.ministry_id = g.ministry_id and (ur.group_id = gid or ur.group_id is null) and ur.role = ''read_only'''),
      ('storage_photo_read_allowed(text)',
       'ur.group_id = g.id',
       '(ur.group_id = g.id or (ur.role = ''read_only'' and ur.group_id is null))'),
      ('storage_photo_write_allowed(text, text, text)',
       'ur.group_id = v_group and ur.role = ''read_only''',
       '(ur.group_id = v_group or ur.group_id is null) and ur.role = ''read_only''')
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

alter table user_roles drop constraint role_group_scope_check;
alter table user_roles add constraint role_group_scope_check check (
  (role in ('admin', 'general_coordinator') and group_id is null)
  or (role = 'sub_coordinator' and group_id is not null)
  or role = 'read_only'
  or role = 'servant');

create or replace function read_only_everywhere_rule()
returns trigger language plpgsql security definer as $$
begin
  if new.role = 'read_only' then
    if new.group_id is null then
      if exists (select 1 from user_roles where ministry_id = new.ministry_id and user_id = new.user_id
                   and role = 'read_only' and group_id is null and id is distinct from new.id) then
        raise exception 'This person already has Read Only Access everywhere';
      end if;
      -- The every-group grant covers them all.
      delete from user_roles where ministry_id = new.ministry_id and user_id = new.user_id
        and role = 'read_only' and group_id is not null and id is distinct from new.id;
    elsif exists (select 1 from user_roles where ministry_id = new.ministry_id and user_id = new.user_id
                    and role = 'read_only' and group_id is null and id is distinct from new.id) then
      raise exception 'This person already has Read Only Access everywhere';
    end if;
  end if;
  return new;
end
$$;
drop trigger if exists trg_read_only_everywhere on user_roles;
create trigger trg_read_only_everywhere before insert or update of role, group_id on user_roles
  for each row execute function read_only_everywhere_rule();

do $$
declare s text := current_schema();
begin
  execute format('alter function read_only_everywhere_rule() set search_path = %I, public, pg_temp', s);
  revoke all on function read_only_everywhere_rule() from public, anon, authenticated;
end
$$;

-- Existing full sets become one grant each (the trigger removes the
-- per-group ones): read-only on at least two groups, and every current
-- regular group is covered by read-only or by a role they already hold.
insert into user_roles (ministry_id, user_id, role, group_id)
select distinct r.ministry_id, r.user_id, 'read_only'::app_role, null::uuid
from user_roles r
where r.role = 'read_only' and r.group_id is not null
  and (select count(*) from user_roles z
       where z.ministry_id = r.ministry_id and z.user_id = r.user_id and z.role = 'read_only' and z.group_id is not null) >= 2
  and not exists (
    select 1 from groups g
    where g.ministry_id = r.ministry_id and g.kind = 'regular' and not g.is_archived
      and not exists (select 1 from user_roles y
                      where y.ministry_id = r.ministry_id and y.user_id = r.user_id and y.group_id = g.id));
