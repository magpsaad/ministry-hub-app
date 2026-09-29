-- B5_switch_say_paths_down.sql -- UNDO of B5_switch_say_paths.sql.
--     begin; set local search_path to qa; \i B5_switch_say_paths_down.sql; commit;
-- Points SAY's stored paths back at the original flat files (which B5 never
-- deletes -- only possible before the old copies are removed after G4).
-- Only strips the SAY/<folder>/ prefix this step added; "last updated"
-- times are left untouched.

do $$
declare
  s text := current_schema();
  v_missing int;
begin
  if s not in ('qa', 'prod') then raise exception 'Run with search_path set to qa or prod (got %)', s; end if;
  select count(*) into v_missing from (
    select 1 from members m where m.photo_path like 'SAY/members/%'
       and not exists (select 1 from storage.objects o where o.bucket_id = s || '-photos' and o.name = substr(m.photo_path, length('SAY/members/') + 1))
    union all
    select 1 from profiles p where p.photo_path like 'SAY/profiles/%'
       and not exists (select 1 from storage.objects o where o.bucket_id = s || '-photos' and o.name = substr(p.photo_path, length('SAY/profiles/') + 1))
    union all
    select 1 from service_calendar_events e where e.attachment_url like 'SAY/calendar/%'
       and not exists (select 1 from storage.objects o where o.bucket_id = s || '-calendar' and o.name = substr(e.attachment_url, length('SAY/calendar/') + 1))
  ) x;
  if v_missing > 0 then
    raise exception '% original file(s) no longer exist -- cannot point back at them', v_missing;
  end if;
end
$$;

alter table members disable trigger trg_members_updated_at;
alter table app_settings disable trigger trg_app_settings_updated_at;

update members set photo_path = substr(photo_path, length('SAY/members/') + 1) where photo_path like 'SAY/members/%';
update profiles set photo_path = substr(photo_path, length('SAY/profiles/') + 1) where photo_path like 'SAY/profiles/%';
update service_calendar_events set attachment_url = substr(attachment_url, length('SAY/calendar/') + 1)
where attachment_url like 'SAY/calendar/%';

do $$
declare s text := current_schema();
begin
  update app_settings set logo_url = replace(logo_url, '/' || s || '-branding/SAY/branding/', '/' || s || '-branding/')
  where ministry_id = 'SAY';
end
$$;

alter table members enable trigger trg_members_updated_at;
alter table app_settings enable trigger trg_app_settings_updated_at;
