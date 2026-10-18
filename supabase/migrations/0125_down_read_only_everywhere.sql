-- 0125_down_read_only_everywhere.sql -- undoes 0125: every-group read-only
-- grants go back to one grant per current regular group, and the checks
-- forget the every-group meaning. Deploy the app without "all groups"
-- first.
--     begin; set local search_path to qa; \i 0125_down_read_only_everywhere.sql; commit;

do $$
begin
  if current_schema() not in ('qa', 'prod') then
    raise exception 'Run with search_path set to qa or prod (got %)', current_schema();
  end if;
end
$$;

drop trigger if exists trg_read_only_everywhere on user_roles;
drop function if exists read_only_everywhere_rule();

-- Back to one grant per current regular group (none where they already
-- hold a role there).
insert into user_roles (ministry_id, user_id, role, group_id)
select r.ministry_id, r.user_id, 'read_only'::app_role, g.id
from user_roles r
join groups g on g.ministry_id = r.ministry_id and g.kind = 'regular' and not g.is_archived
where r.role = 'read_only' and r.group_id is null
  and not exists (select 1 from user_roles y where y.ministry_id = r.ministry_id and y.user_id = r.user_id and y.group_id = g.id);
delete from user_roles where role = 'read_only' and group_id is null;

alter table user_roles drop constraint role_group_scope_check;
alter table user_roles add constraint role_group_scope_check check (
  (role in ('admin', 'general_coordinator') and group_id is null)
  or (role = 'sub_coordinator' and group_id is not null)
  or (role = 'read_only' and group_id is not null)
  or role = 'servant');

do $$
declare
  s text := current_schema();
  v text;
  r record;
begin
  for r in
    select * from (values
      ('accessible_group_ids(boolean)',
       '(ur.group_id = g.id or (ur.role = ''read_only'' and ur.group_id is null))',
       'ur.group_id = g.id'),
      ('has_readonly_or_full_group_access(uuid, uuid)',
       'where ur.user_id = uid and ur.ministry_id = g.ministry_id and (ur.group_id = gid or ur.group_id is null) and ur.role = ''read_only''',
       'where ur.user_id = uid and ur.group_id = gid and ur.role = ''read_only'''),
      ('storage_photo_read_allowed(text)',
       '(ur.group_id = g.id or (ur.role = ''read_only'' and ur.group_id is null))',
       'ur.group_id = g.id'),
      ('storage_photo_write_allowed(text, text, text)',
       '(ur.group_id = v_group or ur.group_id is null) and ur.role = ''read_only''',
       'ur.group_id = v_group and ur.role = ''read_only''')
    ) t(fn, a, b)
  loop
    v := pg_get_functiondef(format('%I.%s', s, r.fn)::regprocedure);
    if position(r.a in v) = 0 then
      raise exception '% has changed; restore it by hand', r.fn;
    end if;
    execute replace(v, r.a, r.b);
  end loop;
end
$$;
