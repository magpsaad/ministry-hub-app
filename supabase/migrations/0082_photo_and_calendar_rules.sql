-- 0082_photo_and_calendar_rules.sql -- PHOTO FILE RULES + CALENDAR SAFETY NET
-- (security audit #3; owner-approved 4 Oct 2026).
-- Run once per environment, QA first:
--     begin; set local search_path to qa; \i 0082_photo_and_calendar_rules.sql; commit;
-- Undo with 0082_down_photo_and_calendar_rules.sql.
--
-- PHOTOS -- the files now follow the same rules as the records (before, any
-- app user of a ministry could delete or overwrite any photo file in it):
-- * Youth photo (<M>/members/<youth id>-<time>.<ext>):
--     add a file   -- anyone who can see that youth's class, Read-Only included
--     delete       -- only someone who can edit that class (its Servant or
--                     Coordinator, General Coordinators, Admins)
-- * Servant photo (<M>/profiles/servant-<servant id>-<time>.<ext>): the
--   servant themselves, or a Coordinator / General Coordinator / Admin.
-- * Overwriting a file in place: nobody (the app always writes a new file).
-- * Anyone may delete a file they uploaded themselves that no record uses
--   (clean-up after a refused upload, or the old file after a replace).
-- * Whoever may delete a file may also see it (storage needs that to delete;
--   since 0075 the old file of a replaced photo couldn't be removed).
-- * add_member_photo() (the Read-Only "add a first photo" path) only accepts
--   a file uploaded for that youth in this ministry's folder.
--
-- CALENDAR -- still open to all servants (owner's design), plus:
-- * Every add, edit and delete is written to the audit log by the database
--   (who, which event, what changed) -- whichever way the change arrives.
--   (The app stops writing its own, thinner entries.) Work done directly in
--   the database (no signed-in user) isn't logged.
-- * Recycle bin: a deleted event is kept for 30 days in
--   calendar_events_deleted; an Admin can restore it (restore_calendar_event).
-- * Someone whose only role in the ministry is Read-Only can't change it.

do $$
begin
  if current_schema() not in ('qa', 'prod') then
    raise exception 'Run with search_path set to qa or prod (got %)', current_schema();
  end if;
end
$$;

-- A copy of the function this changes, for the undo.
do $$
declare b text := current_schema() || '_premm_backup';
begin
  execute format('create schema if not exists %I', b);
  execute format('create table if not exists %I.fn_backup_0082 (sig text primary key, def text not null)', b);
  execute format($q$insert into %I.fn_backup_0082 (sig, def)
    select p.oid::regprocedure::text, pg_get_functiondef(p.oid) from pg_proc p
    where p.pronamespace = current_schema()::regnamespace and p.proname = 'add_member_photo'
    on conflict (sig) do nothing$q$, b);
end
$$;

-- ================================================================== PHOTOS
create or replace function storage_photo_write_allowed(p_name text, p_op text, p_owner text)
returns boolean language plpgsql stable security definer as $$
declare
  v_folders text[] := storage.foldername(p_name);
  v_m text := (storage.foldername(p_name))[1];
  v_kind text := (storage.foldername(p_name))[2];
  v_file text := storage.filename(p_name);
  v_uid uuid := auth.uid();
  v_id uuid;
  v_group uuid;
  v_gkind group_kind;
  v_full boolean;
begin
  if v_uid is null or coalesce(array_length(v_folders, 1), 0) <> 2
     or coalesce(v_m, '') !~ '^[A-Z]{3}$' or not ministry_exists(v_m) then
    return false;
  end if;

  -- Your own upload that no record uses: always yours to clean up.
  if p_op = 'delete' and p_owner = v_uid::text
     and not exists (select 1 from members where photo_path = p_name)
     and not exists (select 1 from profiles where photo_path = p_name) then
    return true;
  end if;
  if p_op not in ('insert', 'delete') then
    return false;  -- overwriting in place: nobody
  end if;

  if v_kind = 'members' then
    begin
      v_id := substring(v_file from '^([0-9a-fA-F-]{36})-')::uuid;
    exception when others then
      return false;
    end;
    if v_id is null then return false; end if;
    select m.group_id, g.kind into v_group, v_gkind
    from members m join groups g on g.id = m.group_id
    where m.id = v_id and m.ministry_id = v_m;
    if v_group is null then return false; end if;
    v_full := is_admin_in(v_m, v_uid)
      or (v_gkind = 'regular' and (
            is_admin_or_gc_in(v_m, v_uid)
            or (ministry_is_active(v_m) and factor_ok(v_uid) and exists (
                  select 1 from user_roles ur
                  where ur.ministry_id = v_m and ur.user_id = v_uid and ur.group_id = v_group and ur.role <> 'read_only'))));
    if p_op = 'delete' then return v_full; end if;
    return v_full
      or (v_gkind = 'regular' and ministry_is_active(v_m) and factor_ok(v_uid) and exists (
            select 1 from user_roles ur
            where ur.ministry_id = v_m and ur.user_id = v_uid and ur.group_id = v_group and ur.role = 'read_only'));

  elsif v_kind = 'profiles' then
    begin
      v_id := substring(v_file from '^servant-([0-9a-fA-F-]{36})-')::uuid;
    exception when others then
      return false;
    end;
    if v_id is null or not exists (select 1 from profiles where id = v_id and ministry_id = v_m) then
      return false;
    end if;
    return v_id = v_uid or is_coordinator_in(v_m, v_uid);
  end if;
  return false;
end
$$;

create or replace function add_member_photo(p_member_id uuid, p_photo_path text)
returns boolean language plpgsql security definer as $$
declare
  v_group_id uuid; v_rows int;
begin
  select group_id into v_group_id from members where id = p_member_id and ministry_id = current_ministry_id();
  if v_group_id is null then raise exception 'Member not found'; end if;
  if not has_readonly_or_full_group_access(v_group_id) then raise exception 'Not authorized to view this member'; end if;
  -- Only a file uploaded for this youth, in this ministry's folder.
  if p_photo_path is null
     or p_photo_path !~ ('^' || current_ministry_id() || '/members/' || p_member_id::text || '-[0-9]+\.[A-Za-z0-9]{1,8}$') then
    raise exception 'That isn''t a photo uploaded for this person';
  end if;
  update members set photo_path = p_photo_path where id = p_member_id and photo_path is null;
  get diagnostics v_rows = row_count;
  return v_rows > 0;
end
$$;

do $$
declare s text := current_schema(); b text := current_schema() || '-photos';
begin
  execute format('alter function storage_photo_write_allowed(text, text, text) set search_path = %I, public, pg_temp', s);
  execute format('alter function add_member_photo(uuid, text) set search_path = %I, public, pg_temp', s);
  execute 'revoke all on function storage_photo_write_allowed(text, text, text) from public, anon';
  execute 'grant execute on function storage_photo_write_allowed(text, text, text) to authenticated, service_role';

  execute format('drop policy if exists %I on storage.objects', b || '_insert');
  execute format('create policy %I on storage.objects for insert to authenticated with check (bucket_id = %L and %I.storage_photo_write_allowed(name, ''insert'', owner_id))',
                 b || '_insert', b, s);
  execute format('drop policy if exists %I on storage.objects', b || '_delete');
  execute format('create policy %I on storage.objects for delete to authenticated using (bucket_id = %L and %I.storage_photo_write_allowed(name, ''delete'', owner_id))',
                 b || '_delete', b, s);
  -- No overwriting in place.
  execute format('drop policy if exists %I on storage.objects', b || '_update');
  execute format('drop policy if exists %I on storage.objects', b || '_select');
  execute format('create policy %I on storage.objects for select to authenticated using (bucket_id = %L and (%I.storage_photo_read_allowed(name) or %I.storage_photo_write_allowed(name, ''delete'', owner_id)))',
                 b || '_select', b, s, s);
end
$$;

-- ================================================================ CALENDAR
create table if not exists calendar_events_deleted (
  id          uuid primary key,
  ministry_id text not null references ministries(id),
  event       jsonb not null,
  deleted_at  timestamptz not null default now(),
  deleted_by  uuid
);
alter table calendar_events_deleted enable row level security;
drop policy if exists calendar_events_deleted_select on calendar_events_deleted;
create policy calendar_events_deleted_select on calendar_events_deleted for select
  using (ministry_id = (select current_ministry_id()) and (select is_admin()));
revoke all on calendar_events_deleted from anon, authenticated;
grant select on calendar_events_deleted to authenticated;

create or replace function calendar_events_audit()
returns trigger language plpgsql security definer as $$
declare
  v_uid uuid := auth.uid();
  v_row service_calendar_events;
  v_type audit_action_type;
  v_details jsonb;
  v_has_profile boolean;
begin
  if tg_op = 'INSERT' then v_row := new; v_type := 'CALENDAR_EVENT_CREATED';
  elsif tg_op = 'UPDATE' then v_row := new; v_type := 'CALENDAR_EVENT_UPDATED';
  else v_row := old; v_type := 'CALENDAR_EVENT_DELETED';
  end if;

  if tg_op = 'DELETE' then
    insert into calendar_events_deleted (id, ministry_id, event, deleted_by)
    values (old.id, old.ministry_id, to_jsonb(old), v_uid)
    on conflict (id) do update set event = excluded.event, deleted_at = now(), deleted_by = excluded.deleted_by;
    delete from calendar_events_deleted where deleted_at < now() - interval '30 days';
  end if;

  -- Work done directly in the database (no signed-in user) isn't logged.
  if v_uid is null then return null; end if;
  if not coalesce((select enabled from audit_config where ministry_id = v_row.ministry_id and action_type = v_type), true) then
    return null;
  end if;

  v_details := jsonb_build_object('eventId', v_row.id, 'title', v_row.title, 'start_date', v_row.start_date);
  if tg_op = 'UPDATE' then
    v_details := v_details || jsonb_build_object('changed',
      (select coalesce(jsonb_object_agg(n.key, jsonb_build_object('from', to_jsonb(old) -> n.key, 'to', n.value)), '{}'::jsonb)
       from jsonb_each(to_jsonb(new)) n where to_jsonb(old) -> n.key is distinct from n.value));
  end if;
  if tg_op = 'INSERT' and current_setting('app.calendar_restore', true) = 'on' then
    v_details := v_details || jsonb_build_object('restored', true);
  end if;
  v_has_profile := exists (select 1 from profiles where id = v_uid and ministry_id = v_row.ministry_id);
  if not v_has_profile then
    v_details := v_details || jsonb_build_object('user_id', v_uid);
  end if;
  insert into audit_log (ministry_id, user_id, action_type, details)
  values (v_row.ministry_id, case when v_has_profile then v_uid end, v_type, v_details);
  return null;
end
$$;

drop trigger if exists trg_calendar_events_audit on service_calendar_events;
create trigger trg_calendar_events_audit
  after insert or update or delete on service_calendar_events
  for each row execute function calendar_events_audit();

create or replace function restore_calendar_event(p_id uuid)
returns void language plpgsql security definer as $$
declare
  v_m text := current_ministry_id();
  v_ev jsonb;
begin
  if not is_admin_in(v_m) then
    raise exception 'Only Admins can restore a deleted event';
  end if;
  select event into v_ev from calendar_events_deleted where id = p_id and ministry_id = v_m;
  if v_ev is null then raise exception 'That deleted event is no longer in the recycle bin'; end if;
  -- Its creator may since have been removed: the restoring Admin stands in.
  if not exists (select 1 from profiles where id = (v_ev ->> 'created_by')::uuid and ministry_id = v_m) then
    v_ev := jsonb_set(v_ev, '{created_by}', to_jsonb(auth.uid()));
  end if;
  perform set_config('app.calendar_restore', 'on', true);
  insert into service_calendar_events select * from jsonb_populate_record(null::service_calendar_events, v_ev);
  perform set_config('app.calendar_restore', 'off', true);
  delete from calendar_events_deleted where id = p_id;
end
$$;

-- Read-Only-only people can't change the calendar (everyone else still can).
drop policy if exists calendar_write on service_calendar_events;
create policy calendar_write on service_calendar_events for all
  using ((ministry_id = (select current_ministry_id())) and (select is_app_user())
         and ((select is_church_admin()) or exists (
               select 1 from user_roles ur
               where ur.ministry_id = (select current_ministry_id()) and ur.user_id = (select auth.uid()) and ur.role <> 'read_only')))
  with check ((ministry_id = (select current_ministry_id())) and (select is_app_user())
         and ((select is_church_admin()) or exists (
               select 1 from user_roles ur
               where ur.ministry_id = (select current_ministry_id()) and ur.user_id = (select auth.uid()) and ur.role <> 'read_only')));

do $$
declare s text := current_schema();
begin
  execute format('alter function calendar_events_audit() set search_path = %I, public, pg_temp', s);
  execute format('alter function restore_calendar_event(uuid) set search_path = %I, public, pg_temp', s);
  execute 'revoke all on function calendar_events_audit() from public, anon, authenticated';
  execute 'revoke all on function restore_calendar_event(uuid) from public, anon';
  execute 'grant execute on function restore_calendar_event(uuid) to authenticated, service_role';
end
$$;
