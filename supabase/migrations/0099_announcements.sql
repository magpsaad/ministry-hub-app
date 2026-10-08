-- 0099_announcements.sql -- ANNOUNCEMENTS (owner-approved design, 8 Oct 2026)
--
-- * Who posts: System Admins and General Coordinators (anything in their
--   ministry), the Church Admin (from the console, to the ministries they
--   pick), and Coordinators -- only to the Servants of the classes they
--   coordinate (all, or the ones they pick) and/or to all their fellow
--   Coordinators. No "Everyone" for Coordinators.
-- * Who it's for: everyone, or any of the roles servant / sub_coordinator /
--   general_coordinator / admin ("System Admins") / read_only; Servants and
--   Coordinators can be narrowed to classes (none picked = all). Optionally
--   also shown to youths on the check-in page after they check in (youths
--   of the picked classes, or of all classes).
-- * Normal = Dashboard banner each person can dismiss; Important = one-time
--   pop-up ("Got it") with a read list for the poster, GCs and Admins.
-- * Show from / until (dates in the ministry's timezone); can be edited or
--   taken down early (people who already tapped "Got it" aren't asked again).
-- * Phone notification "Announcements" (new kind, starts ON): sent when it
--   starts showing, during day hours (9 AM - 9 PM) by notify_tick, to the
--   people it's for (not the poster), honouring My Settings.
-- Run once per environment, QA first:
--     begin; set local search_path to qa; \i 0099_announcements.sql; commit;
-- Undo with 0099_down_announcements.sql.
-- Writes no audit entries (each announcement records who posted it).

do $$
begin
  if current_schema() not in ('qa', 'prod') then
    raise exception 'Run with search_path set to qa or prod (got %)', current_schema();
  end if;
end
$$;

create table if not exists announcements (
  id uuid primary key default gen_random_uuid(),
  ministry_id text not null references ministries(id),
  author_id uuid not null,
  title text not null check (char_length(btrim(title)) between 1 and 120),
  body text not null check (char_length(btrim(body)) between 1 and 2000),
  link_url text check (link_url is null or (link_url ~ '^https?://' and char_length(link_url) <= 500)),
  importance text not null default 'normal' check (importance in ('normal', 'important')),
  roles text[] check (roles is null or (cardinality(roles) > 0
                       and roles <@ array['servant', 'sub_coordinator', 'general_coordinator', 'admin', 'read_only'])),
  servant_group_ids uuid[],
  coordinator_group_ids uuid[],
  include_youth boolean not null default false,
  starts_on date not null,
  ends_on date not null,
  church_post_id uuid,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  taken_down_at timestamptz,
  notified_at timestamptz,
  check (ends_on >= starts_on and ends_on - starts_on <= 366)
);
create index if not exists announcements_ministry_idx on announcements (ministry_id, ends_on desc);
alter table announcements enable row level security;
revoke all on announcements from anon, authenticated;
grant all on announcements to service_role;

create table if not exists announcement_reads (
  announcement_id uuid not null references announcements(id) on delete cascade,
  user_id uuid not null,
  seen_at timestamptz,
  dismissed_at timestamptz,
  acknowledged_at timestamptz,
  primary key (announcement_id, user_id)
);
alter table announcement_reads enable row level security;
revoke all on announcement_reads from anon, authenticated;
grant all on announcement_reads to service_role;

-- ---------------------------------------------------------------------
-- Helpers
-- ---------------------------------------------------------------------
create or replace function announcement_today(p_ministry text)
returns date language sql stable security definer as $$
  select (now() at time zone coalesce((select s.timezone from app_settings s where s.ministry_id = p_ministry),
                                      'America/Toronto'))::date
$$;

-- The people an announcement is for (null roles = everyone with a role here).
create or replace function announcement_audience(p_ministry text, p_roles text[], p_sg uuid[], p_cg uuid[])
returns table (user_id uuid) language sql stable security definer as $$
  select distinct ur.user_id from user_roles ur
  where ur.ministry_id = p_ministry
    and (p_roles is null
         or (ur.role::text = 'servant' and 'servant' = any(p_roles) and (p_sg is null or ur.group_id = any(p_sg)))
         or (ur.role::text = 'sub_coordinator' and 'sub_coordinator' = any(p_roles) and (p_cg is null or ur.group_id = any(p_cg)))
         or (ur.role::text in ('general_coordinator', 'admin', 'read_only') and ur.role::text = any(p_roles)))
    and not exists (select 1 from profiles p where p.ministry_id = p_ministry and p.id = ur.user_id and p.deactivated_at is not null)
$$;

create or replace function announcement_is_for(p_id uuid, p_user uuid)
returns boolean language sql stable security definer as $$
  select exists (select 1 from announcements a
                 cross join lateral announcement_audience(a.ministry_id, a.roles, a.servant_group_ids, a.coordinator_group_ids) x
                 where a.id = p_id and x.user_id = p_user)
$$;

-- The classes this person coordinates here.
create or replace function my_coordinated_groups(p_ministry text, p_user uuid default auth.uid())
returns uuid[] language sql stable security definer as $$
  select coalesce(array_agg(distinct ur.group_id) filter (where ur.group_id is not null), '{}')
  from user_roles ur where ur.ministry_id = p_ministry and ur.user_id = p_user and ur.role = 'sub_coordinator'
$$;

-- Checks and tidies who-it's-for for this poster. Admins/GCs: anything
-- (classes narrow both Servants and Coordinators). Coordinators: Servants
-- of their classes and/or all Coordinators; their classes always kept so
-- youths are only those of their classes.
create or replace function announcement_normalize(p_ministry text, p_roles text[], p_groups uuid[],
  out o_roles text[], out o_sg uuid[], out o_cg uuid[])
language plpgsql stable security definer as $$
declare
  v_full boolean := coalesce(is_admin_or_gc_in(p_ministry), false);
  v_mine uuid[];
  v_groups uuid[] := nullif(p_groups, '{}');
begin
  o_roles := nullif(p_roles, '{}');
  if o_roles is not null and not (o_roles <@ array['servant', 'sub_coordinator', 'general_coordinator', 'admin', 'read_only']) then
    raise exception 'Unknown role in who it''s for.';
  end if;
  if v_groups is not null and exists (select 1 from unnest(v_groups) g
                                      where not exists (select 1 from groups x where x.id = g and x.ministry_id = p_ministry)) then
    raise exception 'Group not found';
  end if;
  if v_full then
    if o_roles is not null and ('servant' = any(o_roles) or 'sub_coordinator' = any(o_roles)) then
      o_sg := v_groups; o_cg := v_groups;
    end if;
    return;
  end if;
  if not (coalesce(is_coordinator_in(p_ministry), false) and cardinality(my_coordinated_groups(p_ministry)) > 0) then
    raise exception 'Only Admins, General Coordinators and Coordinators can post announcements.';
  end if;
  v_mine := my_coordinated_groups(p_ministry);
  if o_roles is null or not (o_roles <@ array['servant', 'sub_coordinator']) then
    raise exception 'Coordinators can post to the Servants of their classes or to fellow Coordinators.';
  end if;
  if v_groups is not null and not (v_groups <@ v_mine) then
    raise exception 'Coordinators can only pick the classes they coordinate.';
  end if;
  o_sg := coalesce(v_groups, v_mine);
  o_cg := null;
end
$$;

-- Queue the phone notification for an announcement (once).
create or replace function announcement_enqueue(p_id uuid)
returns void language plpgsql security definer as $$
declare a announcements;
begin
  select * into a from announcements where id = p_id and notified_at is null and taken_down_at is null;
  if a.id is null then return; end if;
  insert into notification_outbox (ministry_id, event, audience, announcement_id, title, body, url)
  values (a.ministry_id, 'announcement', 'announcement', a.id,
          case when a.importance = 'important' then 'Important: ' else '' end || left(a.title, 110),
          left(a.body, 160), '/announcements');
  update announcements set notified_at = now() where id = a.id;
end
$$;

-- ---------------------------------------------------------------------
-- Posting, editing, taking down
-- ---------------------------------------------------------------------
create or replace function post_announcement(
  p_id uuid, p_title text, p_body text, p_link text, p_importance text,
  p_roles text[], p_groups uuid[], p_include_youth boolean, p_starts_on date, p_ends_on date,
  p_ministries text[] default null)
returns uuid[] language plpgsql security definer as $$
declare
  v_uid uuid := auth.uid();
  v_m text;
  v_ids uuid[] := '{}';
  v_id uuid;
  v_church uuid;
  v_today date;
  v_local time;
  n record;
  a announcements;
begin
  if v_uid is null then raise exception 'Please sign in again'; end if;
  if p_importance not in ('normal', 'important') then raise exception 'Choose Normal or Important.'; end if;
  if nullif(btrim(coalesce(p_link, '')), '') is not null and btrim(p_link) !~ '^https?://' then
    raise exception 'The link must start with https://';
  end if;

  -- Church Admin, from the console: the same post in each ministry picked.
  if p_ministries is not null then
    if not coalesce(is_church_admin(), false) then raise exception 'Only the Church Admin can post to several ministries.'; end if;
    if p_id is not null then raise exception 'Edit it from the announcement itself.'; end if;
    if nullif(p_groups, '{}') is not null then raise exception 'Classes can''t be picked across ministries.'; end if;
    v_church := gen_random_uuid();
    foreach v_m in array p_ministries loop
      if not coalesce(ministry_exists(v_m), false) then raise exception 'Ministry not found'; end if;
      v_today := announcement_today(v_m);
      if p_ends_on < coalesce(p_starts_on, v_today) or p_ends_on < v_today then raise exception 'The end date must be today or later, and not before the start.'; end if;
      insert into announcements (ministry_id, author_id, title, body, link_url, importance, roles, include_youth,
                                 starts_on, ends_on, church_post_id)
      values (v_m, v_uid, btrim(p_title), btrim(p_body), nullif(btrim(coalesce(p_link, '')), ''), p_importance,
              nullif(p_roles, '{}'), coalesce(p_include_youth, false), coalesce(p_starts_on, v_today), p_ends_on, v_church)
      returning id into v_id;
      v_ids := v_ids || v_id;
    end loop;
  else
    v_m := current_ministry_id();
    if not coalesce(ministry_exists(v_m), false) then raise exception 'Please sign in again'; end if;
    select * into n from announcement_normalize(v_m, p_roles, p_groups);
    v_today := announcement_today(v_m);
    if p_ends_on < coalesce(p_starts_on, v_today) or p_ends_on < v_today then raise exception 'The end date must be today or later, and not before the start.'; end if;
    if p_id is null then
      insert into announcements (ministry_id, author_id, title, body, link_url, importance, roles,
                                 servant_group_ids, coordinator_group_ids, include_youth, starts_on, ends_on)
      values (v_m, v_uid, btrim(p_title), btrim(p_body), nullif(btrim(coalesce(p_link, '')), ''), p_importance,
              n.o_roles, n.o_sg, n.o_cg, coalesce(p_include_youth, false), coalesce(p_starts_on, v_today), p_ends_on)
      returning id into v_id;
    else
      select * into a from announcements where id = p_id and ministry_id = v_m and taken_down_at is null;
      if a.id is null then raise exception 'Announcement not found'; end if;
      if a.author_id <> v_uid and not coalesce(is_admin_or_gc_in(v_m), false) then
        raise exception 'Only the person who posted it, a General Coordinator or an Admin can edit it.';
      end if;
      update announcements set title = btrim(p_title), body = btrim(p_body), link_url = nullif(btrim(coalesce(p_link, '')), ''),
             importance = p_importance, roles = n.o_roles, servant_group_ids = n.o_sg, coordinator_group_ids = n.o_cg,
             include_youth = coalesce(p_include_youth, false), starts_on = coalesce(p_starts_on, a.starts_on),
             ends_on = p_ends_on, updated_at = now()
      where id = a.id;
      v_id := a.id;
    end if;
    v_ids := array[v_id];
  end if;

  -- Showing already and it's daytime: the phone notification goes now.
  foreach v_id in array v_ids loop
    select * into a from announcements where id = v_id;
    v_local := (now() at time zone coalesce((select s.timezone from app_settings s where s.ministry_id = a.ministry_id), 'America/Toronto'))::time;
    if a.starts_on <= announcement_today(a.ministry_id) and v_local >= time '09:00' and v_local < time '21:00' then
      perform announcement_enqueue(a.id);
    end if;
  end loop;
  return v_ids;
end
$$;

create or replace function take_down_announcement(p_id uuid)
returns boolean language plpgsql security definer as $$
declare a announcements;
begin
  select * into a from announcements where id = p_id and taken_down_at is null;
  if a.id is null then raise exception 'Announcement not found'; end if;
  if a.author_id <> auth.uid() and not coalesce(is_admin_or_gc_in(a.ministry_id), false) then
    raise exception 'Only the person who posted it, a General Coordinator or an Admin can take it down.';
  end if;
  update announcements set taken_down_at = now(), updated_at = now() where id = a.id;
  return true;
end
$$;

-- How many people a draft reaches (the form's live count).
create or replace function announcement_audience_count(p_roles text[], p_groups uuid[])
returns integer language plpgsql stable security definer as $$
declare v_m text := current_ministry_id(); n record;
begin
  select * into n from announcement_normalize(v_m, p_roles, p_groups);
  return (select count(*) from announcement_audience(v_m, n.o_roles, n.o_sg, n.o_cg) x where x.user_id <> auth.uid());
end
$$;

-- ---------------------------------------------------------------------
-- Reading
-- ---------------------------------------------------------------------
-- The Announcements page: what's for me, what I posted, and (Admins/GCs)
-- everything in the ministry -- current ones and the last 180 days.
create or replace function my_announcements()
returns table (id uuid, title text, body text, link_url text, importance text, author_name text, mine boolean,
               created_at timestamptz, updated_at timestamptz, starts_on date, ends_on date, is_current boolean,
               taken_down boolean, for_me boolean, seen boolean, acknowledged boolean, can_edit boolean,
               roles text[], servant_group_ids uuid[], coordinator_group_ids uuid[], include_youth boolean,
               ack_count integer, audience_count integer)
language plpgsql stable security definer as $$
declare v_uid uuid := auth.uid(); v_m text := current_ministry_id(); v_full boolean; v_today date;
begin
  if v_uid is null or not coalesce(ministry_exists(v_m), false) then raise exception 'Please sign in again'; end if;
  v_full := coalesce(is_admin_or_gc_in(v_m), false);
  v_today := announcement_today(v_m);
  return query
  with base as (
    select a.*, announcement_is_for(a.id, v_uid) as for_me_ from announcements a
    where a.ministry_id = v_m and (a.ends_on >= v_today - 180 or a.created_at > now() - interval '180 days')
  )
  select b.id, b.title, b.body, b.link_url, b.importance,
         coalesce((select p.full_name from profiles p where p.id = b.author_id and p.ministry_id = v_m),
                  case when exists (select 1 from church_admins c where c.user_id = b.author_id) then 'Church Admin' else 'Someone' end),
         b.author_id = v_uid, b.created_at, b.updated_at, b.starts_on, b.ends_on,
         (b.taken_down_at is null and b.starts_on <= v_today and b.ends_on >= v_today),
         b.taken_down_at is not null, b.for_me_,
         coalesce(r.seen_at is not null, false), coalesce(r.acknowledged_at is not null, false),
         (b.author_id = v_uid or v_full) and b.taken_down_at is null,
         b.roles, b.servant_group_ids, b.coordinator_group_ids, b.include_youth,
         case when b.importance = 'important' and (b.author_id = v_uid or v_full)
              then (select count(*)::int from announcement_reads x where x.announcement_id = b.id and x.acknowledged_at is not null) end,
         case when b.author_id = v_uid or v_full
              then (select count(*)::int from announcement_audience(b.ministry_id, b.roles, b.servant_group_ids, b.coordinator_group_ids) x where x.user_id <> b.author_id) end
  from base b
  left join announcement_reads r on r.announcement_id = b.id and r.user_id = v_uid
  where b.for_me_ or b.author_id = v_uid or v_full
  order by (b.taken_down_at is null and b.starts_on <= v_today and b.ends_on >= v_today) desc, b.created_at desc;
end
$$;

-- Unread count for the menu.
create or replace function my_announcement_badge()
returns integer language plpgsql stable security definer as $$
declare v_uid uuid := auth.uid(); v_m text := current_ministry_id(); v_today date;
begin
  if v_uid is null or not coalesce(ministry_exists(v_m), false) then return 0; end if;
  v_today := announcement_today(v_m);
  return (select count(*) from announcements a
          where a.ministry_id = v_m and a.taken_down_at is null and a.starts_on <= v_today and a.ends_on >= v_today
            and a.author_id <> v_uid and announcement_is_for(a.id, v_uid)
            and not exists (select 1 from announcement_reads r where r.announcement_id = a.id and r.user_id = v_uid and r.seen_at is not null));
end
$$;

-- Dashboard banners (Normal, current, for me, not dismissed) and pop-ups
-- (Important, current, for me, not acknowledged).
create or replace function my_current_announcements()
returns table (id uuid, title text, body text, link_url text, importance text, author_name text)
language plpgsql stable security definer as $$
declare v_uid uuid := auth.uid(); v_m text := current_ministry_id(); v_today date;
begin
  if v_uid is null or not coalesce(ministry_exists(v_m), false) then return; end if;
  v_today := announcement_today(v_m);
  return query
  select a.id, a.title, a.body, a.link_url, a.importance,
         coalesce((select p.full_name from profiles p where p.id = a.author_id and p.ministry_id = v_m), 'Church Admin')
  from announcements a
  left join announcement_reads r on r.announcement_id = a.id and r.user_id = v_uid
  where a.ministry_id = v_m and a.taken_down_at is null and a.starts_on <= v_today and a.ends_on >= v_today
    and a.author_id <> v_uid and announcement_is_for(a.id, v_uid)
    and ((a.importance = 'normal' and r.dismissed_at is null) or (a.importance = 'important' and r.acknowledged_at is null))
  order by a.created_at;
end
$$;

-- p_what: 'seen' (opened the Announcements page), 'dismiss' (banner X),
-- 'ack' (Got it).
create or replace function mark_announcement(p_id uuid, p_what text)
returns boolean language plpgsql security definer as $$
declare v_uid uuid := auth.uid();
begin
  if v_uid is null then raise exception 'Please sign in again'; end if;
  if p_what not in ('seen', 'dismiss', 'ack') or not announcement_is_for(p_id, v_uid) then return false; end if;
  insert into announcement_reads (announcement_id, user_id, seen_at, dismissed_at, acknowledged_at)
  values (p_id, v_uid, now(), case when p_what = 'dismiss' then now() end, case when p_what = 'ack' then now() end)
  on conflict (announcement_id, user_id) do update set
    seen_at = coalesce(announcement_reads.seen_at, now()),
    dismissed_at = case when p_what = 'dismiss' then coalesce(announcement_reads.dismissed_at, now()) else announcement_reads.dismissed_at end,
    acknowledged_at = case when p_what = 'ack' then coalesce(announcement_reads.acknowledged_at, now()) else announcement_reads.acknowledged_at end;
  return true;
end
$$;

-- Important announcements: who has tapped "Got it" (poster, GCs, Admins).
create or replace function announcement_read_list(p_id uuid)
returns table (full_name text, acknowledged_at timestamptz)
language plpgsql stable security definer as $$
declare a announcements;
begin
  select * into a from announcements where id = p_id and ministry_id = current_ministry_id();
  if a.id is null then raise exception 'Announcement not found'; end if;
  if a.author_id <> auth.uid() and not coalesce(is_admin_or_gc_in(a.ministry_id), false) then
    raise exception 'Only the person who posted it, a General Coordinator or an Admin can see who has read it.';
  end if;
  return query
  select coalesce(p.full_name, 'Unknown'), r.acknowledged_at
  from announcement_audience(a.ministry_id, a.roles, a.servant_group_ids, a.coordinator_group_ids) x
  left join profiles p on p.id = x.user_id and p.ministry_id = a.ministry_id
  left join announcement_reads r on r.announcement_id = a.id and r.user_id = x.user_id
  where x.user_id <> a.author_id
  order by r.acknowledged_at is null, p.full_name;
end
$$;

-- Youths, after checking in on a class's poster (no sign-in; same server
-- check as the other check-in functions).
create or replace function checkin_announcements(p_token uuid)
returns table (title text, body text, link_url text)
language plpgsql stable security definer as $$
declare v_m text; v_group uuid;
begin
  perform checkin_require_server();
  select q.ministry_id, q.group_id into v_m, v_group from qr_codes q where q.check_in_token = p_token;
  if v_m is null or v_group is null then return; end if;
  return query
  select a.title, a.body, a.link_url from announcements a
  where a.ministry_id = v_m and a.include_youth and a.taken_down_at is null
    and a.starts_on <= announcement_today(v_m) and a.ends_on >= announcement_today(v_m)
    and (a.servant_group_ids is null or v_group = any(a.servant_group_ids))
  order by a.importance = 'important' desc, a.created_at desc
  limit 3;
end
$$;

-- ---------------------------------------------------------------------
-- Phone notifications
-- ---------------------------------------------------------------------
insert into notification_events (event, label, description, roles, default_on, sort_order) values
  ('announcement', 'Announcements', 'When an announcement is posted for you.',
   '{admin,general_coordinator,sub_coordinator,servant,read_only}', true, 15)
on conflict (event) do update
  set label = excluded.label, description = excluded.description, roles = excluded.roles,
      default_on = excluded.default_on, sort_order = excluded.sort_order;

alter table notification_outbox add column if not exists announcement_id uuid references announcements(id) on delete cascade;
alter table notification_outbox drop constraint if exists notification_outbox_audience_check;
alter table notification_outbox add constraint notification_outbox_audience_check
  check (audience in ('admins_gcs', 'person', 'announcement'));
alter table notification_outbox drop constraint if exists notification_outbox_announcement_check;
alter table notification_outbox add constraint notification_outbox_announcement_check
  check ((audience = 'announcement') = (announcement_id is not null));

create or replace function push_claim(p_limit integer default 20)
returns table (outbox_id bigint, title text, body text, url text, devices jsonb)
language plpgsql security definer as $$
begin
  perform app_server_check();
  return query
  with picked as (
    select o.id from notification_outbox o
    where o.sent_at is null and o.attempts < 5 and o.created_at > now() - interval '1 day'
      and (o.claimed_at is null or o.claimed_at < now() - interval '2 minutes')
    order by o.created_at
    limit greatest(1, least(coalesce(p_limit, 20), 100))
    for update skip locked
  ), claimed as (
    update notification_outbox o set claimed_at = now(), attempts = o.attempts + 1
    from picked where o.id = picked.id
    returning o.*
  )
  select c.id, c.title, c.body, c.url,
         coalesce((
           select jsonb_agg(jsonb_build_object('endpoint', s.endpoint, 'p256dh', s.p256dh, 'auth', s.auth))
           from push_subscriptions s
           where s.ministry_id = c.ministry_id
             and ((c.audience = 'admins_gcs'
                   and exists (select 1 from user_roles ur
                               where ur.ministry_id = c.ministry_id and ur.user_id = s.user_id
                                 and ur.role in ('admin', 'general_coordinator')))
               or (c.audience = 'person' and s.user_id = c.target_user_id)
               or (c.audience = 'announcement'
                   and exists (select 1 from announcements an
                               where an.id = c.announcement_id and an.taken_down_at is null and an.author_id <> s.user_id
                                 and announcement_is_for(an.id, s.user_id))))
             and not exists (select 1 from profiles p
                             where p.ministry_id = c.ministry_id and p.id = s.user_id and p.deactivated_at is not null)
             and coalesce((select np.enabled from notification_preferences np
                           where np.user_id = s.user_id and np.ministry_id = c.ministry_id and np.event = c.event),
                          notification_default(c.ministry_id, c.event))
         ), '[]'::jsonb)
  from claimed c;
end
$$;

-- notify_tick (0095) plus: announcements that start showing are announced
-- by phone during day hours.
create or replace function notify_tick()
returns integer language plpgsql security definer as $$
declare
  r record; rec record;
  v_local timestamp; v_today date; v_daytime boolean;
  v_queued int := 0;
  v_names text[]; v_keys text[];
  v_day int; v_hour int; v_y int; v_b int; v_p int; v_g int; v_parts text[];
  v_before int; v_after int; v_label text;
  v_url text;
begin
  for r in
    select m.id, coalesce(s.timezone, 'America/Toronto') tz,
           coalesce(s.birthday_window_days_before, 7) before_days,
           coalesce(s.birthday_window_days_after, 14) after_days
    from ministries m join app_settings s on s.ministry_id = m.id
    where m.is_active
  loop
    v_local := now() at time zone r.tz;
    v_today := v_local::date;
    v_daytime := v_local::time >= time '09:00' and v_local::time < time '21:00';

    if v_daytime then
      -- 0. Announcements that are now showing.
      for rec in
        select a.id from announcements a
        where a.ministry_id = r.id and a.notified_at is null and a.taken_down_at is null
          and a.starts_on <= v_today and a.ends_on >= v_today
      loop
        perform announcement_enqueue(rec.id);
        v_queued := v_queued + 1;
      end loop;

      if exists (select 1 from push_subscriptions ps
                 where ps.ministry_id = r.id and notify_wants(r.id, ps.user_id, 'outreach_needed')) then
        for rec in
          select y.assigned_servant_id uid,
                 array_agg(notify_short(y.full_name) order by y.full_name) names,
                 array_agg(y.episode) keys
          from notification_yellow(r.id) y
          where y.assigned_servant_id is not null
            and not exists (select 1 from notification_marks k
                            where k.event = 'outreach_needed' and k.target_user_id = y.assigned_servant_id
                              and k.mark_key = y.episode)
            and notify_wants(r.id, y.assigned_servant_id, 'outreach_needed')
          group by y.assigned_servant_id
        loop
          insert into notification_marks (event, target_user_id, mark_key, ministry_id)
          select 'outreach_needed', rec.uid, k, r.id from unnest(rec.keys) k on conflict do nothing;
          perform notify_person(r.id, 'outreach_needed', rec.uid, 'Outreach needed',
            notify_names(rec.names) || case when array_length(rec.names, 1) = 1 then ' hasn''t' else ' haven''t' end
            || ' been at service in a while. Please reach out.');
          v_queued := v_queued + 1;
        end loop;
      end if;

      for rec in
        select st.target_user_id uid from notification_staged st
        where st.ministry_id = r.id and st.event = 'newly_assigned'
        group by st.target_user_id
        having max(st.created_at) < now() - interval '2 minutes'
      loop
        select array_agg(notify_short(x.full_name) order by x.full_name) into v_names
        from (select distinct mem.id, mem.full_name
              from notification_staged st
              join members mem on mem.id = st.member_id
              join groups g on g.id = mem.group_id and not g.is_archived and g.kind::text <> 'terminal'
              where st.ministry_id = r.id and st.event = 'newly_assigned' and st.target_user_id = rec.uid
                and mem.assigned_servant_id = rec.uid and mem.is_new_assignment and mem.status::text = 'active') x;
        if v_names is not null and notify_wants(r.id, rec.uid, 'newly_assigned') then
          perform notify_person(r.id, 'newly_assigned', rec.uid, 'Newly assigned to you',
            notify_names(v_names) || case when array_length(v_names, 1) = 1 then ' is' else ' are' end
            || ' now assigned to you. Say hello!');
          v_queued := v_queued + 1;
        end if;
        delete from notification_staged
        where ministry_id = r.id and event = 'newly_assigned' and target_user_id = rec.uid;
      end loop;

      for rec in
        select oe.servant_id uid,
               array_agg(notify_short(mem.full_name) order by mem.full_name) names,
               array_agg(oe.id::text) keys
        from outreach_entries oe
        join members mem on mem.id = oe.member_id
        join groups g on g.id = mem.group_id and not g.is_archived and g.kind::text <> 'terminal'
        where oe.ministry_id = r.id and oe.follow_up_due = v_today and oe.follow_up_dismissed_at is null
          and oe.servant_id is not null
          and not exists (select 1 from notification_marks k
                          where k.event = 'follow_up_due' and k.target_user_id = oe.servant_id and k.mark_key = oe.id::text)
          and notify_wants(r.id, oe.servant_id, 'follow_up_due')
        group by oe.servant_id
      loop
        insert into notification_marks (event, target_user_id, mark_key, ministry_id)
        select 'follow_up_due', rec.uid, k, r.id from unnest(rec.keys) k on conflict do nothing;
        perform notify_person(r.id, 'follow_up_due', rec.uid, 'Follow-up due today',
          'Your follow-up' || case when array_length(rec.names, 1) = 1 then '' else 's' end
          || ' with ' || notify_names(rec.names) || case when array_length(rec.names, 1) = 1 then ' is' else ' are' end
          || ' due today.');
        v_queued := v_queued + 1;
      end loop;

      for rec in
        select mem.assigned_servant_id uid,
               array_agg(notify_short(mem.full_name) order by mem.full_name) names,
               array_agg(mem.id::text || ':' || v_today::text) keys
        from members mem
        join groups g on g.id = mem.group_id and not g.is_archived and g.kind::text <> 'terminal'
        where mem.ministry_id = r.id and mem.status::text = 'active' and mem.date_of_birth is not null
          and mem.assigned_servant_id is not null
          and notify_bday_this_year(mem.date_of_birth, extract(year from v_today)::int) = v_today
          and not exists (select 1 from notification_marks k
                          where k.event = 'birthday' and k.target_user_id = mem.assigned_servant_id
                            and k.mark_key = mem.id::text || ':' || v_today::text)
          and notify_wants(r.id, mem.assigned_servant_id, 'birthday')
        group by mem.assigned_servant_id
      loop
        insert into notification_marks (event, target_user_id, mark_key, ministry_id)
        select 'birthday', rec.uid, k, r.id from unnest(rec.keys) k on conflict do nothing;
        perform notify_person(r.id, 'birthday', rec.uid, 'Birthday today 🎂',
          case when array_length(rec.names, 1) = 1 then 'Today is ' || rec.names[1] || '''s birthday.'
               else 'Today is the birthday of ' || notify_names(rec.names) || '.' end);
        v_queued := v_queued + 1;
      end loop;
    end if;

    for rec in
      select distinct ps.user_id uid from push_subscriptions ps
      where ps.ministry_id = r.id
        and not exists (select 1 from notification_marks k
                        where k.event = 'weekly_recap' and k.target_user_id = ps.user_id
                          and k.mark_key = 'week:' || v_today::text)
        and notify_wants(r.id, ps.user_id, 'weekly_recap')
    loop
      select coalesce(np.weekly_day, 6), coalesce(np.weekly_hour, 9) into v_day, v_hour
      from (select 1) one
      left join notification_preferences np
        on np.user_id = rec.uid and np.ministry_id = r.id and np.event = 'weekly_recap';
      if extract(dow from v_local)::int = v_day and extract(hour from v_local)::int >= v_hour then
        select count(*) into v_y from notification_yellow(r.id) y where y.assigned_servant_id = rec.uid;
        select count(*) into v_b from members mem
          join groups g on g.id = mem.group_id and not g.is_archived and g.kind::text <> 'terminal'
          where mem.ministry_id = r.id and mem.status::text = 'active' and mem.is_new_assignment
            and mem.assigned_servant_id = rec.uid;
        select count(*) into v_p from outreach_entries oe
          join members mem on mem.id = oe.member_id
          join groups g on g.id = mem.group_id and not g.is_archived and g.kind::text <> 'terminal'
          where oe.ministry_id = r.id and oe.servant_id = rec.uid and oe.follow_up_due is not null
            and oe.follow_up_dismissed_at is null and oe.follow_up_due <= v_today;
        select count(*) into v_g from (
          select (notify_bday_this_year(mem.date_of_birth, extract(year from v_today)::int)
                  - make_date(extract(year from v_today)::int, 1, 1))
                 - (v_today - make_date(extract(year from v_today)::int, 1, 1)) diff
          from members mem
          join groups g on g.id = mem.group_id and not g.is_archived and g.kind::text <> 'terminal'
          where mem.ministry_id = r.id and mem.status::text = 'active' and mem.date_of_birth is not null
            and mem.assigned_servant_id = rec.uid
        ) b
        where (case when b.diff < -r.before_days then b.diff + 365
                    when b.diff > r.after_days then b.diff - 365 else b.diff end) between -r.before_days and r.after_days;

        insert into notification_marks (event, target_user_id, mark_key, ministry_id)
        values ('weekly_recap', rec.uid, 'week:' || v_today::text, r.id) on conflict do nothing;
        if v_y + v_b + v_p + v_g > 0 then
          v_parts := array[]::text[];
          if v_y > 0 then v_parts := v_parts || (v_y || ' need' || case when v_y = 1 then 's' else '' end || ' outreach'); end if;
          if v_b > 0 then v_parts := v_parts || (v_b || ' newly assigned'); end if;
          if v_p > 0 then v_parts := v_parts || (v_p || ' follow-up' || case when v_p = 1 then '' else 's' end || ' due'); end if;
          if v_g > 0 then v_parts := v_parts || (v_g || ' birthday' || case when v_g = 1 then '' else 's' end); end if;
          perform notify_person(r.id, 'weekly_recap', rec.uid, 'Your weekly recap',
            array_to_string(v_parts, ' · ') || '. Tap to see them on your Dashboard.');
          v_queued := v_queued + 1;
        end if;
      end if;
    end loop;
  end loop;

  delete from notification_marks where created_at < now() - interval '400 days';
  delete from notification_staged where created_at < now() - interval '3 days';

  if v_queued > 0 then
    begin
      select url into v_url from notification_dispatch where id = 1;
      if v_url is not null then
        perform net.http_post(url := v_url, body := '{}'::jsonb,
                              headers := '{"Content-Type": "application/json"}'::jsonb);
      end if;
    exception when others then
      null;
    end;
  end if;
  return v_queued;
end
$$;

-- ---------------------------------------------------------------------
-- Permissions
-- ---------------------------------------------------------------------
do $$
declare s text := current_schema(); f text;
begin
  foreach f in array array[
    'announcement_today(text)', 'announcement_audience(text, text[], uuid[], uuid[])', 'announcement_is_for(uuid, uuid)',
    'my_coordinated_groups(text, uuid)', 'announcement_normalize(text, text[], uuid[])', 'announcement_enqueue(uuid)',
    'post_announcement(uuid, text, text, text, text, text[], uuid[], boolean, date, date, text[])',
    'take_down_announcement(uuid)', 'announcement_audience_count(text[], uuid[])', 'my_announcements()',
    'my_announcement_badge()', 'my_current_announcements()', 'mark_announcement(uuid, text)',
    'announcement_read_list(uuid)', 'checkin_announcements(uuid)', 'push_claim(integer)', 'notify_tick()'
  ] loop
    execute format('alter function %s set search_path = %I, public, pg_temp', f, s);
  end loop;
  foreach f in array array[
    'announcement_today(text)', 'announcement_audience(text, text[], uuid[], uuid[])', 'announcement_is_for(uuid, uuid)',
    'my_coordinated_groups(text, uuid)', 'announcement_normalize(text, text[], uuid[])', 'announcement_enqueue(uuid)',
    'post_announcement(uuid, text, text, text, text, text[], uuid[], boolean, date, date, text[])',
    'take_down_announcement(uuid)', 'announcement_audience_count(text[], uuid[])', 'my_announcements()',
    'my_announcement_badge()', 'my_current_announcements()', 'mark_announcement(uuid, text)',
    'announcement_read_list(uuid)', 'checkin_announcements(uuid)'
  ] loop
    execute format('revoke all on function %s from public, anon, authenticated', f);
  end loop;
  foreach f in array array[
    'post_announcement(uuid, text, text, text, text, text[], uuid[], boolean, date, date, text[])',
    'take_down_announcement(uuid)', 'announcement_audience_count(text[], uuid[])', 'my_announcements()',
    'my_announcement_badge()', 'my_current_announcements()', 'mark_announcement(uuid, text)',
    'announcement_read_list(uuid)'
  ] loop
    execute format('grant execute on function %s to authenticated, service_role', f);
  end loop;
  -- The check-in page runs without a sign-in; the server key is the check.
  execute 'grant execute on function checkin_announcements(uuid) to anon, authenticated, service_role';
end
$$;
