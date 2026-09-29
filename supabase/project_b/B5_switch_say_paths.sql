-- B5_switch_say_paths.sql -- Project B phase B5, step 2 (MULTI_TENANT_PLAN.md §7).
-- Run AFTER B5_copy_say_files.mjs has copied and verified every file:
--     begin; set local search_path to qa; \i B5_switch_say_paths.sql; commit;
--
-- Points SAY's stored photo, calendar-attachment and logo paths at the
-- copies inside SAY/ (e.g. "abc.jpg" -> "SAY/members/abc.jpg"). Refuses to
-- run unless EVERY copy already exists in storage, so no photo can ever
-- point at a missing file. The "last updated" times are left untouched
-- (this is housekeeping, not an edit). The old files are NOT deleted here.
-- Undo with B5_switch_say_paths_down.sql (the old files are still there).

do $$
declare
  s text := current_schema();
  v_missing int;
begin
  if s not in ('qa', 'prod') then raise exception 'Run with search_path set to qa or prod (got %)', s; end if;

  select count(*) into v_missing from (
    select 1 from members m where m.ministry_id = 'SAY' and m.photo_path is not null
       and m.photo_path !~* '^https?://' and m.photo_path !~ '^[A-Z]{3}/'
       and not exists (select 1 from storage.objects o where o.bucket_id = s || '-photos' and o.name = 'SAY/members/' || m.photo_path)
    union all
    select 1 from profiles p where p.ministry_id = 'SAY' and p.photo_path is not null
       and p.photo_path !~* '^https?://' and p.photo_path !~ '^[A-Z]{3}/'
       and not exists (select 1 from storage.objects o where o.bucket_id = s || '-photos' and o.name = 'SAY/profiles/' || p.photo_path)
    union all
    select 1 from service_calendar_events e where e.ministry_id = 'SAY' and e.attachment_url is not null
       and e.attachment_url !~ '^[A-Z]{3}/'
       and not exists (select 1 from storage.objects o where o.bucket_id = s || '-calendar' and o.name = 'SAY/calendar/' || e.attachment_url)
    union all
    select 1 from app_settings a where a.ministry_id = 'SAY'
       and a.logo_url like '%/storage/v1/object/public/' || s || '-branding/%'
       and split_part(a.logo_url, '/' || s || '-branding/', 2) !~ '^[A-Z]{3}/'
       and not exists (select 1 from storage.objects o where o.bucket_id = s || '-branding'
                       and o.name = 'SAY/branding/' || split_part(a.logo_url, '/' || s || '-branding/', 2))
  ) x;
  if v_missing > 0 then
    raise exception '% file(s) have not been copied into SAY/ yet -- run B5_copy_say_files.mjs first', v_missing;
  end if;
end
$$;

alter table members disable trigger trg_members_updated_at;
alter table app_settings disable trigger trg_app_settings_updated_at;

update members set photo_path = 'SAY/members/' || photo_path
where ministry_id = 'SAY' and photo_path is not null and photo_path !~* '^https?://' and photo_path !~ '^[A-Z]{3}/';

update profiles set photo_path = 'SAY/profiles/' || photo_path
where ministry_id = 'SAY' and photo_path is not null and photo_path !~* '^https?://' and photo_path !~ '^[A-Z]{3}/';

update service_calendar_events set attachment_url = 'SAY/calendar/' || attachment_url
where ministry_id = 'SAY' and attachment_url is not null and attachment_url !~ '^[A-Z]{3}/';

do $$
declare s text := current_schema();
begin
  update app_settings
  set logo_url = replace(logo_url, '/' || s || '-branding/', '/' || s || '-branding/SAY/branding/')
  where ministry_id = 'SAY'
    and logo_url like '%/storage/v1/object/public/' || s || '-branding/%'
    and split_part(logo_url, '/' || s || '-branding/', 2) !~ '^[A-Z]{3}/';
end
$$;

alter table members enable trigger trg_members_updated_at;
alter table app_settings enable trigger trg_app_settings_updated_at;

-- Post-check: nothing of SAY's is left on an old flat path.
do $$
begin
  if exists (select 1 from members where ministry_id = 'SAY' and photo_path !~* '^https?://' and photo_path !~ '^SAY/members/')
     or exists (select 1 from profiles where ministry_id = 'SAY' and photo_path !~* '^https?://' and photo_path !~ '^SAY/profiles/')
     or exists (select 1 from service_calendar_events where ministry_id = 'SAY' and attachment_url !~ '^SAY/calendar/') then
    raise exception 'Some SAY paths were not switched';
  end if;
end
$$;
