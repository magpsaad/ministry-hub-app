-- 0084_locked_fields.sql -- ONLY THE FIELDS THE APP EDITS CAN BE CHANGED
-- (security audit #5; owner-approved 4 Oct 2026).
-- Run once per environment, QA first:
--     begin; set local search_path to qa; \i 0084_locked_fields.sql; commit;
-- Undo with 0084_down_locked_fields.sql.
--
-- The screens only send the fields they show, but the database accepted any
-- field from a signed-in person calling it directly. Now (for signed-in
-- people; the database's own functions and direct database work are
-- unaffected):
-- * Youth records: only the edit form's fields, assignment, moving class and
--   the photo can be changed (full name, registration comments, join date,
--   status and the rest stay locked). New youth records only come from the
--   check-in page or Admin tools, never straight from a person.
-- * Servant profiles: only phone, gender, Father of Confession and photo can
--   be changed (name and email are locked, as on screen). A new profile's
--   email is always the person's real sign-in email.
-- * Photos: a youth's / servant's photo must be a file uploaded for that same
--   person in this ministry's folder (servants may also keep their Google
--   picture) -- no outside links.
-- * Calendar: only the event's own fields; "created by" is always the person
--   creating it; an attachment must be that event's own file.
-- * Outreach: added only under your own name; its youth and author can't be
--   changed afterwards.
-- * Pending servants: the only change is approving, recorded under the
--   approver's own name.
-- Writes no audit entries.

do $$
begin
  if current_schema() not in ('qa', 'prod') then
    raise exception 'Run with search_path set to qa or prod (got %)', current_schema();
  end if;
end
$$;

-- -------------------------------------------------------- column rights
revoke insert, update on members from authenticated;
grant update (phone, email, university_id, program_of_study, date_of_birth, father_of_confession, home_address,
              gender, servant_comments, is_visitor, is_new_assignment, assigned_servant_id, group_id, photo_path)
  on members to authenticated;

revoke update on profiles from authenticated;
grant update (phone, father_of_confession, gender, photo_path) on profiles to authenticated;

revoke insert, update on service_calendar_events from authenticated;
grant insert (title, description, event_type, start_date, end_date, all_day, start_time, end_time, location, created_by)
  on service_calendar_events to authenticated;
grant update (title, description, event_type, start_date, end_date, all_day, start_time, end_time, location, attachment_url)
  on service_calendar_events to authenticated;

revoke update on outreach_entries from authenticated;
grant update (occurred_at, type, notes, follow_up_due, follow_up_dismissed_at) on outreach_entries to authenticated;

revoke update on pending_servants from authenticated;
grant update (approved_at, approved_by) on pending_servants to authenticated;

-- Outreach is added under your own name only.
drop policy if exists outreach_insert on outreach_entries;
create policy outreach_insert on outreach_entries for insert
  with check ((ministry_id = (select current_ministry_id()))
              and servant_id = (select auth.uid())
              and ((select is_admin()) or (member_id in (
                    select m.id from members m where m.group_id = any ((select accessible_group_ids(false))::uuid[])))));

-- --------------------------------------------- value checks and stamps
-- The attendance -> join-date bookkeeping now runs as the database itself
-- (join date is no longer a field people can change).
alter function update_join_date_on_attendance() security definer;

-- The person's own sign-in email (used when their profile is created).
create or replace function my_sign_in_email()
returns text language sql stable security definer as $$
  select u.email from auth.users u where u.id = auth.uid();
$$;

-- Runs as the caller, so current_user is "authenticated" exactly when a
-- signed-in person changes the row themselves; the database's own functions
-- run as their owner and are trusted to set these fields.
create or replace function guard_person_fields()
returns trigger language plpgsql security invoker as $$
begin
  if current_user not in ('authenticated', 'anon') then
    return new;
  end if;

  if tg_table_name = 'members' then
    if new.photo_path is not null and new.photo_path is distinct from (case when tg_op = 'UPDATE' then old.photo_path end)
       and new.photo_path !~ ('^' || new.ministry_id || '/members/' || new.id::text || '-[0-9]+\.[A-Za-z0-9]{1,8}$') then
      raise exception 'That isn''t a photo uploaded for this person';
    end if;

  elsif tg_table_name = 'profiles' then
    if tg_op = 'INSERT' then
      new.email := my_sign_in_email();
    end if;
    if new.photo_path is not null and new.photo_path is distinct from (case when tg_op = 'UPDATE' then old.photo_path end)
       and new.photo_path !~ ('^' || new.ministry_id || '/profiles/servant-' || new.id::text || '-[0-9]+\.[A-Za-z0-9]{1,8}$')
       and new.photo_path !~ '^https://lh[0-9]+\.googleusercontent\.com/' then
      raise exception 'That isn''t a photo uploaded for this person';
    end if;

  elsif tg_table_name = 'service_calendar_events' then
    if tg_op = 'INSERT' then
      new.created_by := auth.uid();
    end if;
    if new.attachment_url is not null and new.attachment_url is distinct from (case when tg_op = 'UPDATE' then old.attachment_url end)
       and new.attachment_url !~ ('^' || new.ministry_id || '/calendar/' || new.id::text || '-[0-9]+\.[A-Za-z0-9]{1,10}$') then
      raise exception 'That isn''t a file uploaded for this event';
    end if;

  elsif tg_table_name = 'pending_servants' then
    if tg_op = 'UPDATE' and new.approved_at is distinct from old.approved_at then
      new.approved_by := auth.uid();
    end if;
  end if;
  return new;
end
$$;

drop trigger if exists trg_guard_person_fields on members;
create trigger trg_guard_person_fields before insert or update on members
  for each row execute function guard_person_fields();
drop trigger if exists trg_guard_person_fields on profiles;
create trigger trg_guard_person_fields before insert or update on profiles
  for each row execute function guard_person_fields();
drop trigger if exists trg_guard_person_fields on service_calendar_events;
create trigger trg_guard_person_fields before insert or update on service_calendar_events
  for each row execute function guard_person_fields();
drop trigger if exists trg_guard_person_fields on pending_servants;
create trigger trg_guard_person_fields before update on pending_servants
  for each row execute function guard_person_fields();

do $$
begin
  execute format('alter function guard_person_fields() set search_path = %I, public, pg_temp', current_schema());
  execute format('alter function my_sign_in_email() set search_path = %I, public, pg_temp', current_schema());
  execute format('alter function update_join_date_on_attendance() set search_path = %I, public, pg_temp', current_schema());
  execute 'revoke all on function my_sign_in_email() from public, anon';
  execute 'grant execute on function my_sign_in_email() to authenticated, service_role';
end
$$;
