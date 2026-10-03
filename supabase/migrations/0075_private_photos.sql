-- 0075_private_photos.sql -- PRIVATE PHOTOS (owner-requested, 3 Oct 2026: "all photos of
-- anyone in the database in private secured folders, even the adults, including the
-- servants"; MULTI_TENANT_PLAN.md P7).
-- Run once per environment, QA first, AFTER the app code that shows photos
-- through /api/photo is live (that code works with the bucket public or private):
--     begin; set local search_path to qa; \i 0075_private_photos.sql; commit;
-- Undo with 0075_down_private_photos.sql.
--
-- * The <env>-photos bucket becomes private: its files can no longer be
--   opened by web address.
-- * Its read rule now admits only a signed-in person who could see that
--   person in the app, judged by the photo's own ministry folder (storage
--   requests carry no ministry address):
--     <M>/members/...  someone with access to that youth's class (the same
--                      rule as accessible_group_ids: Church Admin, the
--                      ministry's Admins, its General Coordinators for
--                      regular classes, or a role on that class; hidden
--                      groups Admin-only) -- the file must be a youth's
--                      current photo;
--     <M>/profiles/... anyone with a role in ministry M (the Servant
--                      Directory shows every servant's photo);
--     anything else    nobody (two old, unused files at the bucket root).
-- * Writing (upload/replace/delete) is unchanged. Logos (branding bucket)
--   stay public: they are shown on sign-in pages and home-screen icons.
-- Writes no audit entries.

do $$
begin
  if current_schema() not in ('qa', 'prod') then
    raise exception 'Run with search_path set to qa or prod (got %)', current_schema();
  end if;
  if not exists (select 1 from storage.buckets where id = current_schema() || '-photos') then
    raise exception 'Bucket %-photos not found', current_schema();
  end if;
end
$$;

create index if not exists idx_members_photo_path on members (photo_path) where photo_path is not null;

create or replace function storage_photo_read_allowed(p_name text)
returns boolean language sql stable security definer as $$
  with x as (
    select (storage.foldername(p_name))[1] as m, (storage.foldername(p_name))[2] as kind, auth.uid() as uid
  )
  select case
    when x.uid is null or coalesce(x.m, '') !~ '^[A-Z]{3}$' then false
    when not is_app_user_in(x.m, x.uid) then false
    when x.kind = 'profiles' then true
    when x.kind = 'members' then exists (
      select 1
      from members mem
      join groups g on g.id = mem.group_id
      where mem.ministry_id = x.m and mem.photo_path = p_name
        and (is_church_admin(x.uid)
             or exists (select 1 from user_roles ur where ur.ministry_id = x.m and ur.user_id = x.uid and ur.role = 'admin')
             or (g.kind = 'regular' and exists (
                   select 1 from user_roles ur
                   where ur.ministry_id = x.m and ur.user_id = x.uid
                     and (ur.role = 'general_coordinator' or ur.group_id = g.id)))))
    else false
  end
  from x;
$$;

do $$
declare s text := current_schema(); b text := current_schema() || '-photos';
begin
  execute format('alter function storage_photo_read_allowed(text) set search_path = %I, public, pg_temp', s);
  execute 'revoke all on function storage_photo_read_allowed(text) from public, anon';
  execute 'grant execute on function storage_photo_read_allowed(text) to authenticated, service_role';

  execute format('drop policy if exists %I on storage.objects', b || '_select');
  execute format('create policy %I on storage.objects for select to authenticated using (bucket_id = %L and %I.storage_photo_read_allowed(name))',
                 b || '_select', b, s);
  update storage.buckets set public = false where id = b;
end
$$;
