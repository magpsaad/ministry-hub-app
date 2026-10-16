-- 0118_calendar_alerts_read_only.sql (owner-requested 16 Oct 2026)
--
-- A. SERVICE CALENDAR ALERTS. When an event is added, changed or removed,
--    the people it's for (a whole-ministry event: everyone; a grade/class
--    event: those classes' people, plus GCs and Admins) get a phone alert
--    -- once edits have paused for 10 minutes, in the daytime, so a burst of
--    edits or a recurring series makes one alert. A change is called out:
--    "Changed: Youth Meeting (Fri Oct 23)". The person who made the change
--    isn't alerted about it. Past events are left out. New kind 'calendar'
--    ("Service Calendar") in My Settings -> Notifications, default ON.
--    * calendar_changes: what's waiting to go out, one row per event.
--    * trg_calendar_note_change on service_calendar_events.
--    * notify_calendar_changes(), called from notify_tick's daytime part.
--
-- B. READ-ONLY ACCESS, two Ministry Settings switches:
--    * app_settings.read_only_can_add_photos (default ON, as today): a
--      Read-only person may add a photo to a youth with none.
--    * app_settings.read_only_can_take_attendance (default OFF, as today):
--      a Read-only person may mark youth Present/Absent in their group.
--      An extra rule beside attendance_insert/attendance_delete.
--
-- Run once per environment, QA first:
--     begin; set local search_path to qa; \i 0118_calendar_alerts_read_only.sql; commit;
-- Undo with 0118_down_calendar_alerts_read_only.sql. Writes no audit entries.

do $$
begin
  if current_schema() not in ('qa', 'prod') then
    raise exception 'Run with search_path set to qa or prod (got %)', current_schema();
  end if;
end
$$;

-- ---------- B. Read-only switches
alter table app_settings
  add column if not exists read_only_can_add_photos boolean not null default true,
  add column if not exists read_only_can_take_attendance boolean not null default false;

create or replace function readonly_attendance_on()
returns boolean language sql stable security definer as $$
  select coalesce((select s.read_only_can_take_attendance from app_settings s where s.ministry_id = current_ministry_id()), false)
$$;

drop policy if exists attendance_insert_read_only on attendance_records;
create policy attendance_insert_read_only on attendance_records for insert
  with check (
    ministry_id = (select current_ministry_id())
    and attendee_type = 'member'
    and (select readonly_attendance_on())
    and member_id in (select m.id from members m where m.group_id = any ((select accessible_group_ids(true))::uuid[]))
  );
drop policy if exists attendance_delete_read_only on attendance_records;
create policy attendance_delete_read_only on attendance_records for delete
  using (
    ministry_id = (select current_ministry_id())
    and attendee_type = 'member'
    and (select readonly_attendance_on())
    and member_id in (select m.id from members m where m.group_id = any ((select accessible_group_ids(true))::uuid[]))
  );

do $$
declare v text; a text; b text;
begin
  v := pg_get_functiondef('add_member_photo(uuid, text)'::regprocedure);
  a := E'  if not has_readonly_or_full_group_access(v_group_id) then raise exception ''Not authorized to view this member''; end if;\n';
  b := a || E'  if not (v_group_id = any (accessible_group_ids(false)))\n'
            || E'     and not coalesce((select s.read_only_can_add_photos from app_settings s where s.ministry_id = current_ministry_id()), true) then\n'
            || E'    raise exception ''Read-only access can''''t add photos in this ministry'';\n'
            || E'  end if;\n';
  if position(a in v) = 0 then
    raise exception 'add_member_photo has changed; patch it by hand';
  end if;
  execute replace(v, a, b);
end
$$;

-- ---------- A. Calendar alerts
create table if not exists calendar_changes (
  event_id uuid primary key,
  ministry_id text not null references ministries(id),
  kind text not null check (kind in ('added', 'changed', 'removed')),
  title text not null,
  start_date date not null,
  audience text not null,
  group_ids uuid[] not null default '{}',
  changed_by uuid,
  changed_at timestamptz not null default now()
);
create index if not exists calendar_changes_ministry_idx on calendar_changes (ministry_id, changed_at);
alter table calendar_changes enable row level security;
revoke all on calendar_changes from anon, authenticated;
grant all on calendar_changes to service_role;

create or replace function calendar_note_change()
returns trigger language plpgsql security definer as $$
declare
  v_row service_calendar_events;
  v_today date;
  v_kind text;
begin
  v_row := case when tg_op = 'DELETE' then old else new end;
  v_today := (now() at time zone coalesce((select s.timezone from app_settings s where s.ministry_id = v_row.ministry_id), 'America/Toronto'))::date;
  -- Past events don't need an alert.
  if coalesce(v_row.end_date, v_row.start_date) < v_today then
    return null;
  end if;
  if tg_op = 'UPDATE'
     and (new.title, new.description, new.start_date, new.end_date, new.all_day, new.start_time, new.end_time,
          new.location, new.audience, new.audience_group_ids)
         is not distinct from
         (old.title, old.description, old.start_date, old.end_date, old.all_day, old.start_time, old.end_time,
          old.location, old.audience, old.audience_group_ids) then
    return null;
  end if;
  if tg_op = 'DELETE' then
    -- Added and removed before anyone was told: nothing to say.
    delete from calendar_changes where event_id = old.id and kind = 'added';
    if found then
      return null;
    end if;
    v_kind := 'removed';
  elsif tg_op = 'INSERT' then
    v_kind := 'added';
  else
    v_kind := 'changed';
  end if;
  insert into calendar_changes (event_id, ministry_id, kind, title, start_date, audience, group_ids, changed_by)
  values (v_row.id, v_row.ministry_id, v_kind, v_row.title, v_row.start_date, v_row.audience,
          coalesce(v_row.audience_group_ids, '{}'), auth.uid())
  on conflict (event_id) do update
    set kind = case when calendar_changes.kind = 'added' and excluded.kind = 'changed' then 'added' else excluded.kind end,
        title = excluded.title, start_date = excluded.start_date, audience = excluded.audience,
        group_ids = excluded.group_ids, changed_by = excluded.changed_by, changed_at = now();
  return null;
end
$$;
drop trigger if exists trg_calendar_note_change on service_calendar_events;
create trigger trg_calendar_note_change after insert or update or delete on service_calendar_events
  for each row execute function calendar_note_change();

create or replace function notify_calendar_changes(p_ministry text)
returns integer language plpgsql security definer as $$
declare
  v_last timestamptz;
  v_n integer := 0;
  rec record;
  v_lines text[];
  v_more integer;
  v_title text;
begin
  select max(c.changed_at) into v_last from calendar_changes c where c.ministry_id = p_ministry;
  if v_last is null or v_last > now() - interval '10 minutes' then
    return 0;
  end if;
  for rec in
    with ch as (
      select * from calendar_changes c where c.ministry_id = p_ministry and c.changed_at <= v_last
    ), who as (
      select distinct ch.event_id, ur.user_id uid
      from ch join user_roles ur on ur.ministry_id = p_ministry
      where ch.audience = 'all' or ur.role::text in ('admin', 'general_coordinator') or ur.group_id = any (ch.group_ids)
    ), mine as (
      select w.uid, ch.kind, ch.title, count(*) n, min(ch.start_date) first_date
      from who w join ch on ch.event_id = w.event_id
      where w.uid is distinct from ch.changed_by
      group by w.uid, ch.kind, ch.title
    )
    select m.uid,
           bool_or(m.kind = 'changed') any_changed,
           bool_or(m.kind = 'removed') any_removed,
           array_agg(
             case m.kind when 'changed' then 'Changed: ' when 'removed' then 'Cancelled: ' else 'New: ' end
             || m.title || ' ('
             || case when m.n = 1 then to_char(m.first_date, 'Dy Mon FMDD')
                     else m.n || ' dates from ' || to_char(m.first_date, 'Mon FMDD') end
             || ')'
             order by case m.kind when 'changed' then 1 when 'removed' then 2 else 3 end, m.first_date, m.title) lines
    from mine m
    where notify_wants(p_ministry, m.uid, 'calendar')
    group by m.uid
  loop
    v_lines := rec.lines;
    v_more := cardinality(v_lines) - 3;
    v_title := case when rec.any_changed then '📅 Calendar event changed'
                    when rec.any_removed then '📅 Calendar event cancelled'
                    else '📅 New on the Service Calendar' end;
    insert into notification_outbox (ministry_id, event, audience, target_user_id, title, body, url)
    values (p_ministry, 'calendar', 'person', rec.uid, v_title,
            left(array_to_string(v_lines[1:3], '. ') || case when v_more > 0 then '. And ' || v_more || ' more.' else '.' end, 500),
            '/calendar');
    v_n := v_n + 1;
  end loop;
  delete from calendar_changes where ministry_id = p_ministry and changed_at <= v_last;
  return v_n;
end
$$;

insert into notification_events (event, label, description, roles, default_on, sort_order)
values ('calendar', 'Service Calendar',
        'When an event on the Service Calendar for you is added, changed or cancelled. Sent once edits have paused for 10 minutes (daytime).',
        array['admin', 'general_coordinator', 'sub_coordinator', 'servant', 'read_only'], true, 18)
on conflict (event) do update set label = excluded.label, description = excluded.description, roles = excluded.roles,
                                  default_on = excluded.default_on, sort_order = excluded.sort_order;

do $$
declare v text; n text;
begin
  v := pg_get_functiondef('notify_tick()'::regprocedure);
  if position('notify_calendar_changes' in v) > 0 then
    return;
  end if;
  if position(E'      v_queued := v_queued + notify_tasks_due(r.id, v_today);' in v) = 0 then
    raise exception 'notify_tick has changed; patch it by hand';
  end if;
  n := replace(v, E'      v_queued := v_queued + notify_tasks_due(r.id, v_today);',
               E'      v_queued := v_queued + notify_calendar_changes(r.id);\n      v_queued := v_queued + notify_tasks_due(r.id, v_today);');
  execute n;
end
$$;

do $$
declare s text := current_schema(); f text;
begin
  foreach f in array array['readonly_attendance_on()', 'calendar_note_change()', 'notify_calendar_changes(text)'] loop
    execute format('alter function %s set search_path = %I, public, pg_temp', f, s);
    execute format('revoke all on function %s from public, anon, authenticated', f);
  end loop;
  -- The attendance rule calls this as the signed-in person.
  grant execute on function readonly_attendance_on() to authenticated;
  grant execute on function notify_calendar_changes(text) to service_role;
end
$$;
