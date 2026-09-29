-- 0064_project_b_expand.sql
-- PROJECT B, step "expand" (MULTI_TENANT_PLAN.md §3-§6, §11 phase B3).
--
-- Turns the schema into a multi-ministry schema: every ministry-owned row
-- gets a ministry_id (3-letter code, 'SAY' for the existing data), every
-- security rule and database function is scoped to one ministry, and the
-- database itself refuses rows that point across ministries.
--
-- HOW TO RUN: once per environment, as ONE transaction, QA first:
--     begin;
--     set local search_path to qa;      -- later, only with go-ahead: prod
--     \i 0064_project_b_expand.sql
--     commit;
-- Everything below is unqualified on purpose (lands in whichever schema is
-- on the search_path), and every function gets that schema pinned as its
-- own search_path at the end (section 11).
--
-- SAFE BEFORE THE NEW CODE IS DEPLOYED: current_ministry_id() falls back to
-- 'SAY' (tenancy_settings.default_ministry_id) when a request carries no
-- x-ministry-id header -- which is every request the current app makes --
-- so the running app keeps behaving exactly as before. The fallback is
-- switched off only in the later "contract" step (0066), after the new code
-- is verified.
--
-- NOTHING IS DELETED: no rows are removed or changed; existing rows simply
-- get ministry_id = 'SAY'.

-- 0. Preconditions --------------------------------------------------------
do $$
begin
  if current_schema() not in ('qa', 'prod') then
    raise exception 'Run with search_path set to qa or prod (got %)', current_schema();
  end if;
  if to_regclass(current_schema() || '.ministries') is not null then
    raise exception 'Already applied: %.ministries exists', current_schema();
  end if;
  if (select count(*) from app_settings) <> 1 then
    raise exception 'Expected exactly one app_settings row before conversion';
  end if;
end
$$;

-- 1. New church-wide tables ----------------------------------------------

create table ministries (
  id            text primary key check (id ~ '^[A-Z]{3}$'),
  name          text not null check (length(trim(name)) > 0),
  is_active     boolean not null default true,
  display_order integer not null default 0,
  created_at    timestamptz not null default now()
);

create or replace function ministries_id_is_permanent()
returns trigger language plpgsql as $$
begin
  if new.id is distinct from old.id then
    raise exception 'A ministry code is permanent and cannot be changed (% -> %)', old.id, new.id;
  end if;
  return new;
end
$$;
create trigger trg_ministries_id_permanent before update on ministries
  for each row execute function ministries_id_is_permanent();

insert into ministries (id, name, display_order)
select 'SAY', app_title_long, 1 from app_settings;

-- Which web address belongs to which ministry (or to the Church Admin
-- console). This schema holds this environment's addresses only.
create table ministry_addresses (
  host        text primary key check (host = lower(host) and host !~ '[/\s]'),
  ministry_id text references ministries(id),
  kind        text not null check (kind in ('ministry', 'console')),
  created_at  timestamptz not null default now(),
  check ((kind = 'console') = (ministry_id is null))
);

insert into ministry_addresses (host, ministry_id, kind)
select h, 'SAY', 'ministry'
from unnest(case current_schema()
              when 'qa'   then array['youth-ministry-app-qa.vercel.app', 'localhost:3000']
              when 'prod' then array['youth-ministry-app-prod.vercel.app']
            end) as h;

create table church_admins (
  user_id    uuid primary key references auth.users(id) on delete cascade,
  created_at timestamptz not null default now()
);
-- D2: the owner only.
insert into church_admins (user_id)
select id from auth.users where lower(email) = 'magpsaad@gmail.com';

create table tenancy_settings (
  id                  boolean primary key default true check (id),
  -- Transition fallback: requests with no x-ministry-id header are treated
  -- as this ministry. Set to NULL in 0066 (fail closed).
  default_ministry_id text references ministries(id)
);
insert into tenancy_settings (default_ministry_id) values ('SAY');

-- None of these four tables is reachable through the API directly; only
-- through the narrow security-definer functions below.
alter table ministries         enable row level security;
alter table ministry_addresses enable row level security;
alter table church_admins      enable row level security;
alter table tenancy_settings   enable row level security;
revoke all on ministries, ministry_addresses, church_admins, tenancy_settings from public, anon, authenticated;
grant all on ministries, ministry_addresses, church_admins, tenancy_settings to service_role;

-- 2. The current-ministry function (needed by the column defaults) --------

-- The ministry this request is working in: the x-ministry-id request header
-- (set by the app from the web address) when it is a well-formed 3-letter
-- code, otherwise the transition fallback. It only ever NARROWS what a
-- request can see: every security rule still requires a real role in that
-- ministry. Never raises.
create or replace function current_ministry_id()
returns text language plpgsql stable security definer as $$
declare
  v text;
begin
  begin
    v := nullif(current_setting('request.headers', true), '')::json ->> 'x-ministry-id';
  exception when others then
    v := null;
  end;
  if v ~ '^[A-Z]{3}$' then
    return v;
  end if;
  return (select default_ministry_id from tenancy_settings limit 1);
end
$$;

-- 3. ministry_id on every ministry-owned table (17) ----------------------
-- Added with a constant default so existing rows become 'SAY' instantly
-- (no row rewrite, no triggers fired, updated_at untouched), then the
-- default is switched to the current ministry for new rows.

do $$
declare
  t text;
begin
  foreach t in array array[
    'app_settings', 'groups', 'members', 'universities', 'attendance_records',
    'outreach_entries', 'service_calendar_events', 'holiday_rules', 'verses',
    'qr_codes', 'pending_servants', 'pending_servant_attendance', 'audit_log',
    'audit_config', 'actions_needed_config', 'user_roles', 'profiles'
  ] loop
    execute format('alter table %I add column ministry_id text not null default %L references ministries(id)', t, 'SAY');
    execute format('alter table %I alter column ministry_id set default current_ministry_id()', t);
  end loop;
end
$$;

-- 4. Keys, uniqueness and cross-ministry foreign keys ---------------------

-- 4a. Drop the single-column foreign keys that the composite ones below
-- replace (keeping both would also make the API's table joins ambiguous).
alter table attendance_records      drop constraint attendance_records_member_id_fkey,
                                    drop constraint attendance_records_servant_id_fkey;
alter table audit_log               drop constraint audit_log_group_id_fkey,
                                    drop constraint audit_log_user_id_fkey;
alter table holiday_rules           drop constraint holiday_rules_created_by_fkey;
alter table members                 drop constraint members_group_id_fkey,
                                    drop constraint members_university_id_fkey,
                                    drop constraint members_assigned_servant_id_fkey;
alter table outreach_entries        drop constraint outreach_entries_member_id_fkey,
                                    drop constraint outreach_entries_servant_id_fkey;
alter table pending_servant_attendance drop constraint pending_servant_attendance_pending_servant_id_fkey;
alter table pending_servants        drop constraint pending_servants_approved_by_fkey,
                                    drop constraint pending_servants_resulting_profile_id_fkey,
                                    drop constraint pending_servants_submitted_by_profile_id_fkey;
alter table qr_codes                drop constraint qr_codes_group_id_fkey;
alter table service_calendar_events drop constraint service_calendar_events_created_by_fkey;
alter table user_roles              drop constraint user_roles_group_id_fkey,
                                    drop constraint user_roles_user_id_fkey;

-- 4b. Profiles: one per person PER MINISTRY (D7). id stays the login id.
alter table profiles drop constraint profiles_pkey;
alter table profiles add constraint profiles_pkey primary key (ministry_id, id);

-- 4c. app_settings: one row per ministry.
alter table app_settings drop constraint app_settings_pkey,
                         drop constraint app_settings_singleton;
alter table app_settings add constraint app_settings_pkey primary key (ministry_id);
-- F12: sub-coordinator automatically gets a servant role -- per ministry.
alter table app_settings add column sub_coordinator_auto_servant boolean not null default true;

-- 4d. Targets for the composite foreign keys.
alter table groups           add constraint groups_ministry_id_id_key           unique (ministry_id, id);
alter table members          add constraint members_ministry_id_id_key          unique (ministry_id, id);
alter table universities     add constraint universities_ministry_id_id_key     unique (ministry_id, id);
alter table pending_servants add constraint pending_servants_ministry_id_id_key unique (ministry_id, id);

-- 4e. Composite foreign keys: a row can only point at rows of its own
-- ministry, whoever writes it (L1 in the plan).
alter table members
  add constraint members_group_fkey            foreign key (ministry_id, group_id)            references groups (ministry_id, id),
  add constraint members_university_fkey       foreign key (ministry_id, university_id)       references universities (ministry_id, id),
  add constraint members_assigned_servant_fkey foreign key (ministry_id, assigned_servant_id) references profiles (ministry_id, id);
alter table attendance_records
  add constraint attendance_records_member_fkey  foreign key (ministry_id, member_id)  references members (ministry_id, id),
  add constraint attendance_records_servant_fkey foreign key (ministry_id, servant_id) references profiles (ministry_id, id);
alter table outreach_entries
  add constraint outreach_entries_member_fkey  foreign key (ministry_id, member_id)  references members (ministry_id, id),
  add constraint outreach_entries_servant_fkey foreign key (ministry_id, servant_id) references profiles (ministry_id, id);
alter table service_calendar_events
  add constraint service_calendar_events_created_by_fkey foreign key (ministry_id, created_by) references profiles (ministry_id, id);
alter table holiday_rules
  add constraint holiday_rules_created_by_fkey foreign key (ministry_id, created_by) references profiles (ministry_id, id);
alter table qr_codes
  add constraint qr_codes_group_fkey foreign key (ministry_id, group_id) references groups (ministry_id, id);
alter table pending_servants
  add constraint pending_servants_approved_by_fkey          foreign key (ministry_id, approved_by)             references profiles (ministry_id, id),
  add constraint pending_servants_resulting_profile_fkey    foreign key (ministry_id, resulting_profile_id)    references profiles (ministry_id, id),
  add constraint pending_servants_submitted_by_profile_fkey foreign key (ministry_id, submitted_by_profile_id) references profiles (ministry_id, id);
alter table pending_servant_attendance
  add constraint pending_servant_attendance_pending_fkey foreign key (ministry_id, pending_servant_id)
    references pending_servants (ministry_id, id) on delete cascade;
alter table audit_log
  add constraint audit_log_group_fkey foreign key (ministry_id, group_id) references groups (ministry_id, id),
  add constraint audit_log_user_fkey  foreign key (ministry_id, user_id)  references profiles (ministry_id, id);
alter table user_roles
  add constraint user_roles_group_fkey foreign key (ministry_id, group_id) references groups (ministry_id, id),
  add constraint user_roles_user_fkey  foreign key (ministry_id, user_id)  references profiles (ministry_id, id) on delete cascade;

-- 4f. Uniqueness that used to be church-wide is now per ministry.
alter table groups       drop constraint groups_cohort_year_key;
alter table groups       add constraint groups_ministry_cohort_year_key unique (ministry_id, cohort_year);
alter table universities drop constraint universities_name_key;
alter table universities add constraint universities_ministry_name_key unique (ministry_id, name);

alter table user_roles drop constraint user_roles_user_id_role_group_id_key;
drop index uq_user_roles_null_group;
alter table user_roles add constraint user_roles_ministry_user_role_group_key unique (ministry_id, user_id, role, group_id);
create unique index uq_user_roles_null_group on user_roles (ministry_id, user_id, role) where group_id is null;

-- A servant can attend two different ministries on the same day.
alter table attendance_records drop constraint attendance_records_servant_id_service_date_key;
alter table attendance_records add constraint attendance_records_ministry_servant_date_key unique (ministry_id, servant_id, service_date);

alter table audit_config          drop constraint audit_config_pkey;
alter table audit_config          add constraint audit_config_pkey primary key (ministry_id, action_type);
alter table actions_needed_config drop constraint actions_needed_config_pkey;
alter table actions_needed_config add constraint actions_needed_config_pkey primary key (ministry_id, proximity);

-- One Servants QR per ministry.
create unique index uq_qr_codes_servants_per_ministry on qr_codes (ministry_id) where group_id is null;

-- One open self-registration per person per ministry.
create unique index uq_pending_servants_open_self_registration
  on pending_servants (ministry_id, submitted_by_profile_id)
  where resulting_profile_id is null and submitted_by_profile_id is not null;

-- Import-tracking references: unique within a ministry (future per-ministry
-- import tools, plan §15).
drop index uq_members_legacy_ref;         create unique index uq_members_legacy_ref         on members (ministry_id, legacy_source_ref)                 where legacy_source_ref is not null;
drop index uq_attendance_legacy_ref;      create unique index uq_attendance_legacy_ref      on attendance_records (ministry_id, legacy_source_ref)      where legacy_source_ref is not null;
drop index uq_audit_log_legacy_ref;       create unique index uq_audit_log_legacy_ref       on audit_log (ministry_id, legacy_source_ref)               where legacy_source_ref is not null;
drop index uq_outreach_legacy_ref;        create unique index uq_outreach_legacy_ref        on outreach_entries (ministry_id, legacy_source_ref)        where legacy_source_ref is not null;
drop index uq_calendar_events_legacy_ref; create unique index uq_calendar_events_legacy_ref on service_calendar_events (ministry_id, legacy_source_ref) where legacy_source_ref is not null;
drop index uq_universities_legacy_ref;    create unique index uq_universities_legacy_ref    on universities (ministry_id, legacy_source_ref)            where legacy_source_ref is not null;
drop index uq_verses_legacy_ref;          create unique index uq_verses_legacy_ref          on verses (ministry_id, legacy_source_ref)                  where legacy_source_ref is not null;
drop index uq_profiles_legacy_ref;        create unique index uq_profiles_legacy_ref        on profiles (ministry_id, legacy_source_ref)                where legacy_source_ref is not null;

-- 4g. Ministry-first indexes for the tables every screen filters.
create index idx_attendance_ministry_date on attendance_records (ministry_id, service_date);
create index idx_audit_log_ministry_time  on audit_log (ministry_id, occurred_at desc);
create index idx_members_ministry_group   on members (ministry_id, group_id) where status = 'active';
create index idx_outreach_ministry_member on outreach_entries (ministry_id, member_id);
create index idx_user_roles_ministry_user on user_roles (ministry_id, user_id);
create index idx_groups_ministry_position on groups (ministry_id, ladder_position) where not is_archived;

-- 5. Helper functions (security rules call these) -------------------------

create or replace function is_church_admin(uid uuid default auth.uid())
returns boolean language sql stable security definer as $$
  select exists (select 1 from church_admins where user_id = uid);
$$;

create or replace function ministry_is_active(m text)
returns boolean language sql stable security definer as $$
  select exists (select 1 from ministries where id = m and is_active);
$$;

create or replace function ministry_exists(m text)
returns boolean language sql stable security definer as $$
  select exists (select 1 from ministries where id = m);
$$;

-- Explicit-ministry role checks. The Church Admin passes in every ministry
-- (D3); everyone else needs a role there, and the ministry must be active.
create or replace function is_app_user_in(m text, uid uuid default auth.uid())
returns boolean language sql stable security definer as $$
  select ministry_exists(m) and (
    is_church_admin(uid)
    or (ministry_is_active(m) and exists (select 1 from user_roles where ministry_id = m and user_id = uid))
  );
$$;

create or replace function is_admin_in(m text, uid uuid default auth.uid())
returns boolean language sql stable security definer as $$
  select ministry_exists(m) and (
    is_church_admin(uid)
    or (ministry_is_active(m) and exists (select 1 from user_roles where ministry_id = m and user_id = uid and role = 'admin'))
  );
$$;

create or replace function is_admin_or_gc_in(m text, uid uuid default auth.uid())
returns boolean language sql stable security definer as $$
  select ministry_exists(m) and (
    is_church_admin(uid)
    or (ministry_is_active(m) and exists (
      select 1 from user_roles where ministry_id = m and user_id = uid and role in ('admin', 'general_coordinator')))
  );
$$;

create or replace function is_coordinator_in(m text, uid uuid default auth.uid())
returns boolean language sql stable security definer as $$
  select ministry_exists(m) and (
    is_church_admin(uid)
    or (ministry_is_active(m) and exists (
      select 1 from user_roles where ministry_id = m and user_id = uid
        and role in ('admin', 'general_coordinator', 'sub_coordinator')))
  );
$$;

-- The existing helper names keep their signatures and now mean "in the
-- ministry this request is working in".
create or replace function is_app_user(uid uuid default auth.uid())
returns boolean language sql stable security definer as $$
  select is_app_user_in(current_ministry_id(), uid);
$$;

create or replace function is_admin(uid uuid default auth.uid())
returns boolean language sql stable security definer as $$
  select is_admin_in(current_ministry_id(), uid);
$$;

create or replace function is_admin_or_general_coordinator(uid uuid default auth.uid())
returns boolean language sql stable security definer as $$
  select is_admin_or_gc_in(current_ministry_id(), uid);
$$;

create or replace function is_coordinator(uid uuid default auth.uid())
returns boolean language sql stable security definer as $$
  select is_coordinator_in(current_ministry_id(), uid);
$$;

create or replace function can_manage_servants(uid uuid default auth.uid())
returns boolean language sql stable security definer as $$
  select is_admin_or_general_coordinator(uid);
$$;

-- The group must belong to the current ministry.
create or replace function has_group_access(gid uuid, uid uuid default auth.uid())
returns boolean language sql stable security definer as $$
  select coalesce((
    select g.ministry_id = current_ministry_id()
       and (is_admin_or_gc_in(g.ministry_id, uid)
            or (ministry_is_active(g.ministry_id) and exists (
                  select 1 from user_roles ur
                  where ur.user_id = uid and ur.group_id = gid and ur.role <> 'read_only')))
    from groups g where g.id = gid
  ), false);
$$;

create or replace function has_readonly_or_full_group_access(gid uuid, uid uuid default auth.uid())
returns boolean language sql stable security definer as $$
  select has_group_access(gid, uid) or coalesce((
    select g.ministry_id = current_ministry_id()
       and ministry_is_active(g.ministry_id)
       and exists (select 1 from user_roles ur
                   where ur.user_id = uid and ur.group_id = gid and ur.role = 'read_only')
    from groups g where g.id = gid
  ), false);
$$;

create or replace function group_ministry_id(gid uuid)
returns text language sql stable security definer as $$
  select ministry_id from groups where id = gid;
$$;

-- The single ministry (or console) served at a web address, or nothing.
-- Callable without signing in (the login page needs it). Never lists.
create or replace function resolve_ministry_by_address(p_host text)
returns table(ministry_id text, name text, is_active boolean, kind text)
language sql stable security definer as $$
  select a.ministry_id, m.name, coalesce(m.is_active, true), a.kind
  from ministry_addresses a
  left join ministries m on m.id = a.ministry_id
  where a.host = lower(trim(p_host))
  limit 1;
$$;

-- Storage write rule (used by 0065's storage policies): the first folder of
-- the file path names the ministry (e.g. "SAY/members/x.png"), and the
-- caller needs a role there (Admin for branding). Files still at the old
-- flat paths (no folder) follow today's rule, through the transition
-- fallback, until they are moved into SAY/ (plan §7) -- after 0066 they are
-- no longer writable.
create or replace function storage_write_allowed(p_name text, p_admin_only boolean default false)
returns boolean language sql stable security definer as $$
  select case
    when (storage.foldername(p_name))[1] ~ '^[A-Z]{3}$' then
      case when p_admin_only then is_admin_in((storage.foldername(p_name))[1])
           else is_app_user_in((storage.foldername(p_name))[1]) end
    when coalesce(array_length(storage.foldername(p_name), 1), 0) = 0 then
      case when p_admin_only then is_admin() else is_app_user() end
    else false
  end;
$$;

-- 6. Service-day helpers (per ministry) -----------------------------------

create or replace function is_service_day(p_ministry_id text)
returns boolean language plpgsql stable security definer as $$
declare
  v_weekday smallint;
  v_timezone text;
begin
  select service_weekday, timezone into v_weekday, v_timezone
  from app_settings where ministry_id = p_ministry_id;
  if v_weekday is null or v_timezone is null then
    return false;
  end if;
  return extract(isodow from (now() at time zone v_timezone))::int = v_weekday;
end
$$;

create or replace function is_service_day()
returns boolean language sql stable security definer as $$
  select is_service_day(current_ministry_id());
$$;

create or replace function checkin_today(p_ministry_id text)
returns date language sql stable security definer as $$
  select (now() at time zone (select timezone from app_settings where ministry_id = p_ministry_id))::date;
$$;

create or replace function checkin_today()
returns date language sql stable security definer as $$
  select checkin_today(current_ministry_id());
$$;

-- 7. Public QR check-in functions (no sign-in) ----------------------------
-- Every one starts from the scanned QR code, which names the ministry; the
-- request header plays no part here. Every read and write is limited to
-- that ministry and every insert sets it explicitly.

create or replace function checkin_resolve(p_token uuid)
returns table(r_ministry_id text, r_group_id uuid, r_flow_type qr_flow_type, r_label text)
language plpgsql stable security definer as $$
declare
  v_active boolean;
begin
  select q.ministry_id, q.group_id, q.flow_type, q.label, mi.is_active
    into r_ministry_id, r_group_id, r_flow_type, r_label, v_active
  from qr_codes q
  join ministries mi on mi.id = q.ministry_id
  where q.check_in_token = p_token;
  if r_ministry_id is null then
    raise exception 'Invalid check-in code';
  end if;
  if not v_active then
    raise exception 'This check-in code is no longer active';
  end if;
  return next;
end
$$;

-- Return shape gains ministry_id (the page shows that ministry's branding
-- and school list), so it is dropped and recreated.
drop function checkin_get_flow(uuid);
create function checkin_get_flow(p_token uuid)
returns table(is_servant boolean, flow_type qr_flow_type, label text, ministry_id text)
language plpgsql security definer as $$
declare
  v_m text; v_group_id uuid; v_flow qr_flow_type; v_label text;
begin
  select r_ministry_id, r_group_id, r_flow_type into v_m, v_group_id, v_flow from checkin_resolve(p_token);
  if v_group_id is null then
    v_label := 'Servants';
  else
    select g.name into v_label from groups g where g.id = v_group_id and g.ministry_id = v_m;
  end if;
  return query select (v_group_id is null), v_flow, v_label, v_m;
end
$$;

create or replace function checkin_list_members(p_token uuid)
returns table(member_id uuid, full_name text)
language plpgsql security definer as $$
declare
  v_m text; v_group_id uuid; v_flow qr_flow_type;
begin
  select r_ministry_id, r_group_id, r_flow_type into v_m, v_group_id, v_flow from checkin_resolve(p_token);
  if v_group_id is null then raise exception 'Invalid check-in code'; end if;
  if v_flow <> 'check_in_and_intake' then raise exception 'This code does not support attendance check-in'; end if;
  return query
    select m.id, m.full_name from members m
    where m.ministry_id = v_m and m.group_id = v_group_id and m.status = 'active'
    order by m.full_name;
end
$$;

create or replace function checkin_list_servants(p_token uuid)
returns table(id uuid, full_name text, kind text)
language plpgsql security definer as $$
declare
  v_m text; v_group_id uuid;
begin
  select r_ministry_id, r_group_id into v_m, v_group_id from checkin_resolve(p_token);
  if v_group_id is not null then raise exception 'Invalid check-in code'; end if;
  return query
    with combined as (
      select p.id as p_id, p.full_name as p_full_name, 'servant'::text as p_kind
      from profiles p where p.ministry_id = v_m
      union all
      select ps.id, ps.full_name, 'pending'::text
      from pending_servants ps where ps.ministry_id = v_m and ps.resulting_profile_id is null
    )
    select c.p_id, c.p_full_name, c.p_kind from combined c order by c.p_full_name;
end
$$;

create or replace function checkin_mark_attendance(p_token uuid, p_member_id uuid)
returns table(attendance_recorded boolean, newly_created boolean, missing_phone boolean, missing_email boolean,
              missing_university boolean, missing_program boolean, missing_dob boolean, missing_father_of_confession boolean)
language plpgsql security definer as $$
declare
  v_m text; v_group_id uuid; v_flow qr_flow_type; v_inserted_id uuid; v_member members%rowtype;
begin
  select r_ministry_id, r_group_id, r_flow_type into v_m, v_group_id, v_flow from checkin_resolve(p_token);
  if v_group_id is null then raise exception 'Invalid check-in code'; end if;
  if v_flow <> 'check_in_and_intake' then raise exception 'This code does not support attendance check-in'; end if;

  select * into v_member from members where id = p_member_id and ministry_id = v_m and status = 'active';
  if v_member.group_id is distinct from v_group_id then raise exception 'Member does not belong to this group'; end if;

  if not is_service_day(v_m) then
    return query select false, false,
      (v_member.phone is null or trim(v_member.phone) = ''), (v_member.email is null or trim(v_member.email) = ''),
      (v_member.university_id is null), (v_member.program_of_study is null or trim(v_member.program_of_study) = ''),
      (v_member.date_of_birth is null), (v_member.father_of_confession is null or trim(v_member.father_of_confession) = '');
    return;
  end if;

  insert into attendance_records (ministry_id, attendee_type, member_id, service_date, is_visitor_at_time)
  values (v_m, 'member', p_member_id, checkin_today(v_m), coalesce(v_member.is_visitor, false))
  on conflict (member_id, service_date) do nothing
  returning id into v_inserted_id;

  return query select true, (v_inserted_id is not null),
    (v_member.phone is null or trim(v_member.phone) = ''), (v_member.email is null or trim(v_member.email) = ''),
    (v_member.university_id is null), (v_member.program_of_study is null or trim(v_member.program_of_study) = ''),
    (v_member.date_of_birth is null), (v_member.father_of_confession is null or trim(v_member.father_of_confession) = '');
end
$$;

create or replace function checkin_fill_missing_member_fields(
  p_token uuid, p_member_id uuid, p_phone text default null, p_email text default null,
  p_university_id uuid default null, p_program_of_study text default null,
  p_date_of_birth date default null, p_father_of_confession text default null)
returns void language plpgsql security definer as $$
declare
  v_m text; v_group_id uuid; v_member_group uuid;
begin
  select r_ministry_id, r_group_id into v_m, v_group_id from checkin_resolve(p_token);
  if v_group_id is null then raise exception 'Invalid check-in code'; end if;

  select group_id into v_member_group from members where id = p_member_id and ministry_id = v_m and status = 'active';
  if v_member_group is distinct from v_group_id then raise exception 'Member does not belong to this group'; end if;
  if p_university_id is not null and not exists (select 1 from universities where id = p_university_id and ministry_id = v_m) then
    raise exception 'Unknown school';
  end if;

  update members set
    phone = case when phone is null or trim(phone) = '' then nullif(trim(p_phone), '') else phone end,
    email = case when email is null or trim(email) = '' then nullif(trim(p_email), '') else email end,
    university_id = coalesce(university_id, p_university_id),
    program_of_study = case when program_of_study is null or trim(program_of_study) = '' then nullif(trim(p_program_of_study), '') else program_of_study end,
    date_of_birth = coalesce(date_of_birth, p_date_of_birth),
    father_of_confession = case when father_of_confession is null or trim(father_of_confession) = '' then nullif(trim(p_father_of_confession), '') else father_of_confession end
  where id = p_member_id and ministry_id = v_m;
end
$$;

create or replace function checkin_find_possible_duplicate_member(
  p_token uuid, p_full_name text, p_phone text, p_email text, p_university_id uuid default null,
  p_program_of_study text default null, p_date_of_birth date default null, p_gender text default null)
returns table(member_id uuid, group_name text, same_group boolean, name_matches boolean, phone_matches boolean,
              email_matches boolean, university_matches boolean, program_matches boolean, dob_matches boolean, gender_matches boolean)
language plpgsql security definer as $$
declare
  v_m text; v_group_id uuid; v_flow qr_flow_type;
begin
  select r_ministry_id, r_group_id, r_flow_type into v_m, v_group_id, v_flow from checkin_resolve(p_token);
  if v_group_id is null then raise exception 'Invalid check-in code'; end if;
  if v_flow <> 'check_in_and_intake' then raise exception 'This code does not support attendance check-in'; end if;

  -- Searches ONLY the QR code's ministry (plan §2.5 #12).
  return query
  select m.id, g.name, (m.group_id = v_group_id),
    (lower(trim(m.full_name)) = lower(trim(p_full_name))),
    (m.phone = p_phone),
    (lower(m.email) = lower(p_email)),
    case when p_university_id is null then null when m.university_id is null then false else (m.university_id = p_university_id) end,
    case when p_program_of_study is null or trim(p_program_of_study) = '' then null
         when m.program_of_study is null or trim(m.program_of_study) = '' then false
         else (lower(trim(m.program_of_study)) = lower(trim(p_program_of_study))) end,
    case when p_date_of_birth is null then null when m.date_of_birth is null then false else (m.date_of_birth = p_date_of_birth) end,
    case when p_gender is null or trim(p_gender) = '' then null when m.gender is null then false else (lower(m.gender) = lower(p_gender)) end
  from members m
  join groups g on g.id = m.group_id
  where m.ministry_id = v_m
    and m.status = 'active'
    and (lower(trim(m.full_name)) = lower(trim(p_full_name)) or m.phone = p_phone or lower(m.email) = lower(p_email))
  order by
    (lower(trim(m.full_name)) = lower(trim(p_full_name)))::int desc,
    ((lower(trim(m.full_name)) = lower(trim(p_full_name)))::int + (m.phone = p_phone)::int + (lower(m.email) = lower(p_email))::int) desc,
    (lower(m.email) = lower(p_email))::int desc,
    (m.phone = p_phone)::int desc
  limit 1;
end
$$;

create or replace function checkin_resolve_duplicate_member(
  p_token uuid, p_member_id uuid, p_move_to_scanned_group boolean,
  p_phone text default null, p_update_phone boolean default false,
  p_date_of_birth date default null, p_update_dob boolean default false,
  p_gender text default null, p_update_gender boolean default false,
  p_university_id uuid default null, p_update_university boolean default false,
  p_program_of_study text default null, p_update_program boolean default false,
  p_home_address text default null, p_update_home_address boolean default false,
  p_father_of_confession text default null, p_update_father_of_confession boolean default false)
returns table(attendance_recorded boolean, newly_created boolean)
language plpgsql security definer as $$
declare
  v_m text; v_group_id uuid; v_flow qr_flow_type; v_is_visitor boolean; v_inserted_id uuid;
begin
  select r_ministry_id, r_group_id, r_flow_type into v_m, v_group_id, v_flow from checkin_resolve(p_token);
  if v_group_id is null then raise exception 'Invalid check-in code'; end if;
  if v_flow <> 'check_in_and_intake' then raise exception 'This code does not support attendance check-in'; end if;
  -- Only a member of the QR code's own ministry (plan §2.5 #13).
  if not exists (select 1 from members where id = p_member_id and ministry_id = v_m and status = 'active') then
    raise exception 'Member not found';
  end if;
  if p_update_university and p_university_id is not null
     and not exists (select 1 from universities where id = p_university_id and ministry_id = v_m) then
    raise exception 'Unknown school';
  end if;

  update members set
    phone = case when p_update_phone then p_phone else phone end,
    date_of_birth = case when p_update_dob then p_date_of_birth else date_of_birth end,
    gender = case when p_update_gender then p_gender else gender end,
    university_id = case when p_update_university then p_university_id else university_id end,
    program_of_study = case when p_update_program then p_program_of_study else program_of_study end,
    home_address = case when p_update_home_address then p_home_address else home_address end,
    father_of_confession = case when p_update_father_of_confession then p_father_of_confession else father_of_confession end,
    group_id = case when p_move_to_scanned_group then v_group_id else group_id end
  where id = p_member_id and ministry_id = v_m
  returning is_visitor into v_is_visitor;

  if not is_service_day(v_m) then
    return query select false, false;
    return;
  end if;

  insert into attendance_records (ministry_id, attendee_type, member_id, service_date, is_visitor_at_time)
  values (v_m, 'member', p_member_id, checkin_today(v_m), coalesce(v_is_visitor, false))
  on conflict (member_id, service_date) do nothing
  returning id into v_inserted_id;

  return query select true, (v_inserted_id is not null);
end
$$;

create or replace function checkin_submit_new_member(
  p_token uuid, p_full_name text, p_phone text default null, p_email text default null,
  p_university_id uuid default null, p_program_of_study text default null, p_date_of_birth date default null,
  p_father_of_confession text default null, p_home_address text default null, p_gender text default null,
  p_comments text default null)
returns table(member_id uuid, attendance_recorded boolean)
language plpgsql security definer as $$
#variable_conflict use_column
declare
  v_m text; v_group_id uuid; v_flow qr_flow_type; v_new_member_id uuid; v_recorded boolean := false;
begin
  select r_ministry_id, r_group_id, r_flow_type into v_m, v_group_id, v_flow from checkin_resolve(p_token);
  if v_group_id is null then raise exception 'Invalid check-in code'; end if;
  if p_university_id is not null and not exists (select 1 from universities where id = p_university_id and ministry_id = v_m) then
    raise exception 'Unknown school';
  end if;

  insert into members (ministry_id, group_id, full_name, phone, email, university_id, program_of_study, date_of_birth,
                       father_of_confession, home_address, gender, registration_comments)
  values (v_m, v_group_id, p_full_name, p_phone, p_email, p_university_id, p_program_of_study, p_date_of_birth,
          p_father_of_confession, p_home_address, p_gender, p_comments)
  returning id into v_new_member_id;

  if v_flow = 'check_in_and_intake' and is_service_day(v_m) then
    insert into attendance_records (ministry_id, attendee_type, member_id, service_date)
    values (v_m, 'member', v_new_member_id, checkin_today(v_m))
    on conflict (member_id, service_date) do nothing;
    v_recorded := true;
  end if;

  return query select v_new_member_id, v_recorded;
end
$$;

create or replace function checkin_submit_new_servant(
  p_token uuid, p_full_name text, p_phone text default null, p_email text default null,
  p_father_of_confession text default null, p_gender text default null, p_comments text default null)
returns table(pending_id uuid, attendance_recorded boolean)
language plpgsql security definer as $$
declare
  v_m text; v_group_id uuid; v_pending_id uuid; v_recorded boolean := false;
begin
  select r_ministry_id, r_group_id into v_m, v_group_id from checkin_resolve(p_token);
  if v_group_id is not null then raise exception 'Invalid check-in code'; end if;

  insert into pending_servants (ministry_id, full_name, phone, email, father_of_confession, gender, registration_comments)
  values (v_m, p_full_name, p_phone, p_email, p_father_of_confession, p_gender, p_comments)
  returning id into v_pending_id;

  if is_service_day(v_m) then
    insert into pending_servant_attendance (ministry_id, pending_servant_id, service_date)
    values (v_m, v_pending_id, checkin_today(v_m))
    on conflict (pending_servant_id, service_date) do nothing;
    v_recorded := true;
  end if;

  return query select v_pending_id, v_recorded;
end
$$;

create or replace function checkin_mark_servant_attendance(p_token uuid, p_servant_id uuid)
returns table(attendance_recorded boolean, newly_created boolean)
language plpgsql security definer as $$
declare
  v_m text; v_group_id uuid; v_inserted_id uuid;
begin
  select r_ministry_id, r_group_id into v_m, v_group_id from checkin_resolve(p_token);
  if v_group_id is not null then raise exception 'Invalid check-in code'; end if;
  if not exists (select 1 from profiles where id = p_servant_id and ministry_id = v_m) then
    raise exception 'Servant not found';
  end if;
  if not is_service_day(v_m) then
    return query select false, false;
    return;
  end if;

  insert into attendance_records (ministry_id, attendee_type, servant_id, service_date)
  values (v_m, 'servant', p_servant_id, checkin_today(v_m))
  on conflict (ministry_id, servant_id, service_date) do nothing
  returning id into v_inserted_id;

  return query select true, (v_inserted_id is not null);
end
$$;

create or replace function checkin_mark_pending_servant_attendance(p_token uuid, p_pending_servant_id uuid)
returns table(attendance_recorded boolean, newly_created boolean)
language plpgsql security definer as $$
declare
  v_m text; v_group_id uuid; v_inserted_id uuid;
begin
  select r_ministry_id, r_group_id into v_m, v_group_id from checkin_resolve(p_token);
  if v_group_id is not null then raise exception 'Invalid check-in code'; end if;
  if not exists (select 1 from pending_servants
                 where id = p_pending_servant_id and ministry_id = v_m and resulting_profile_id is null) then
    raise exception 'Pending servant not found';
  end if;
  if not is_service_day(v_m) then
    return query select false, false;
    return;
  end if;

  insert into pending_servant_attendance (ministry_id, pending_servant_id, service_date)
  values (v_m, p_pending_servant_id, checkin_today(v_m))
  on conflict (pending_servant_id, service_date) do nothing
  returning id into v_inserted_id;

  return query select true, (v_inserted_id is not null);
end
$$;

create or replace function checkin_undo_attendance(p_token uuid, p_member_id uuid)
returns void language plpgsql security definer as $$
declare
  v_m text; v_group_id uuid; v_member_group uuid;
begin
  select r_ministry_id, r_group_id into v_m, v_group_id from checkin_resolve(p_token);
  if v_group_id is null then raise exception 'Invalid check-in code'; end if;
  select group_id into v_member_group from members where id = p_member_id and ministry_id = v_m;
  if v_member_group is distinct from v_group_id then raise exception 'Member does not belong to this group'; end if;

  delete from attendance_records
  where ministry_id = v_m and member_id = p_member_id and attendee_type = 'member'
    and service_date = checkin_today(v_m) and created_at > now() - interval '2 minutes';
end
$$;

create or replace function checkin_undo_servant_attendance(p_token uuid, p_servant_id uuid)
returns void language plpgsql security definer as $$
declare
  v_m text; v_group_id uuid;
begin
  select r_ministry_id, r_group_id into v_m, v_group_id from checkin_resolve(p_token);
  if v_group_id is not null then raise exception 'Invalid check-in code'; end if;

  delete from attendance_records
  where ministry_id = v_m and servant_id = p_servant_id and attendee_type = 'servant'
    and service_date = checkin_today(v_m) and created_at > now() - interval '2 minutes';
end
$$;

create or replace function checkin_undo_pending_servant_attendance(p_token uuid, p_pending_servant_id uuid)
returns void language plpgsql security definer as $$
declare
  v_m text; v_group_id uuid;
begin
  select r_ministry_id, r_group_id into v_m, v_group_id from checkin_resolve(p_token);
  if v_group_id is not null then raise exception 'Invalid check-in code'; end if;

  delete from pending_servant_attendance
  where ministry_id = v_m and pending_servant_id = p_pending_servant_id
    and service_date = checkin_today(v_m) and created_at > now() - interval '2 minutes';
end
$$;

-- 8. Admin / Coordinator actions (13) -------------------------------------
-- Pattern: v_m := the ministry this request is working in; check the role
-- IN THAT ministry; every statement filtered to it.

create or replace function add_group_tier(p_cohort_year integer default null, p_name text default null, p_qr_color text default '#999999')
returns uuid language plpgsql security definer as $$
declare
  v_m text := current_ministry_id();
  v_terminal_position smallint; v_insert_position smallint; v_terminal_id uuid; v_new_id uuid; v_name text;
begin
  if not is_admin_in(v_m) then raise exception 'Only Admins may add a group'; end if;
  v_name := nullif(trim(p_name), '');
  if v_name is null then raise exception 'Name is required'; end if;

  select max(ladder_position) into v_terminal_position from groups where ministry_id = v_m and not is_archived;
  if v_terminal_position is null then
    raise exception 'No groups exist yet -- the pre-entry group must exist first';
  end if;

  if v_terminal_position = 0 then
    v_insert_position := 1;
  else
    v_insert_position := v_terminal_position;
    select id into v_terminal_id from groups
    where ministry_id = v_m and ladder_position = v_terminal_position and not is_archived limit 1;
    update groups set ladder_position = v_terminal_position + 1 where id = v_terminal_id;
  end if;

  insert into groups (ministry_id, cohort_year, ladder_position, name, display_order, qr_color)
  values (v_m, p_cohort_year, v_insert_position, v_name,
          (select coalesce(max(display_order), 0) + 1 from groups where ministry_id = v_m), p_qr_color)
  returning id into v_new_id;

  insert into qr_codes (ministry_id, group_id, label, image_path) values (v_m, v_new_id, v_name, '');
  return v_new_id;
end
$$;

create or replace function delete_group_tier(p_group_id uuid)
returns void language plpgsql security definer as $$
declare
  v_m text := current_ministry_id();
  v_position smallint; v_terminal_position smallint; v_active_members integer; v_role_count integer;
begin
  if not is_admin_in(v_m) then raise exception 'Only Admins may remove a group'; end if;

  select ladder_position into v_position from groups where id = p_group_id and ministry_id = v_m and not is_archived;
  if v_position is null then raise exception 'Group not found or already archived'; end if;
  if v_position = 0 then raise exception 'The pre-entry group cannot be removed here'; end if;

  select max(ladder_position) into v_terminal_position from groups where ministry_id = v_m and not is_archived;
  if v_position = v_terminal_position then
    raise exception 'The terminal group cannot be removed directly -- merge it via Group Transition instead';
  end if;

  select count(*) into v_active_members from members where ministry_id = v_m and group_id = p_group_id and status = 'active';
  if v_active_members > 0 then
    raise exception 'This group still has % active member(s) -- reassign them to another group first', v_active_members;
  end if;

  select count(*) into v_role_count from user_roles where ministry_id = v_m and group_id = p_group_id;
  if v_role_count > 0 then
    raise exception 'This group still has % servant/coordinator role grant(s) -- reassign them first', v_role_count;
  end if;

  delete from qr_codes where ministry_id = v_m and group_id = p_group_id;
  update groups set is_archived = true where id = p_group_id;
  update groups set ladder_position = ladder_position - 1
  where ministry_id = v_m and ladder_position > v_position and not is_archived;
end
$$;

create or replace function rename_group(p_group_id uuid, p_name text)
returns void language plpgsql security definer as $$
declare
  v_m text := current_ministry_id();
begin
  if not is_admin_in(v_m) then raise exception 'Only Admins may rename a group'; end if;
  if p_name is null or length(trim(p_name)) = 0 then raise exception 'Name cannot be empty'; end if;
  update groups set name = p_name where id = p_group_id and ministry_id = v_m and not is_archived;
  update qr_codes set label = p_name where group_id = p_group_id and ministry_id = v_m;
end
$$;

create or replace function run_group_transition(new_pre_entry_cohort_year integer)
returns void language plpgsql security definer as $$
declare
  v_m text := current_ministry_id();
  v_template text;
  v_terminal_position smallint;
  v_new_terminal_position smallint;
  v_old_terminal_group_id uuid;
  v_old_terminal_color text;
  v_new_terminal_group groups%rowtype;
  v_new_yr1_group_id uuid;
  v_new_position0_id uuid;
begin
  if not is_admin_in(v_m) then raise exception 'Only Admins may run a Group Transition'; end if;

  select group_name_template into v_template from app_settings where ministry_id = v_m;

  select max(ladder_position) into v_terminal_position from groups where ministry_id = v_m and not is_archived;
  if v_terminal_position is null or v_terminal_position < 2 then
    raise exception 'Group Transition requires at least one active tier between the pre-entry group and the terminal group -- use Add Group on the App Settings screen first';
  end if;
  v_new_terminal_position := v_terminal_position - 1;

  select id, qr_color into v_old_terminal_group_id, v_old_terminal_color
  from groups where ministry_id = v_m and ladder_position = v_terminal_position and not is_archived limit 1;
  select * into v_new_terminal_group
  from groups where ministry_id = v_m and ladder_position = v_new_terminal_position and not is_archived limit 1;
  select id into v_new_yr1_group_id
  from groups where ministry_id = v_m and ladder_position = 0 and not is_archived limit 1;

  if v_new_terminal_group.id is not null then
    if v_old_terminal_group_id is not null then
      update members set group_id = v_new_terminal_group.id
      where ministry_id = v_m and group_id = v_old_terminal_group_id;
      if v_new_yr1_group_id is not null then
        update user_roles set group_id = v_new_yr1_group_id
        where ministry_id = v_m and group_id = v_old_terminal_group_id;
      end if;
      delete from qr_codes where ministry_id = v_m and group_id = v_old_terminal_group_id;
      update groups set is_archived = true where id = v_old_terminal_group_id;
    end if;

    -- Terminal-cohort naming unchanged (terminal concept parked, plan §16).
    update groups
    set ladder_position = v_terminal_position,
        name = v_new_terminal_group.cohort_year::text || ' and earlier - Yr ' || v_terminal_position::text || '+'
    where id = v_new_terminal_group.id;
  end if;

  update groups set ladder_position = ladder_position + 1
  where ministry_id = v_m and ladder_position < v_new_terminal_position and not is_archived;

  update groups
  set name = replace(replace(v_template, '{cohort_year}', cohort_year::text), '{position_label}', ladder_position::text)
  where ministry_id = v_m and cohort_year is not null and not is_archived and ladder_position < v_terminal_position;

  update qr_codes set label = groups.name
  from groups
  where qr_codes.group_id = groups.id and qr_codes.ministry_id = v_m and not groups.is_archived;

  if v_new_yr1_group_id is not null then
    update qr_codes set flow_type = 'check_in_and_intake' where ministry_id = v_m and group_id = v_new_yr1_group_id;
  end if;

  insert into groups (ministry_id, cohort_year, ladder_position, name, display_order, qr_color)
  values (v_m, new_pre_entry_cohort_year, 0,
          replace(replace(v_template, '{cohort_year}', new_pre_entry_cohort_year::text), '{position_label}', '0'),
          (select coalesce(max(display_order), 0) + 1 from groups where ministry_id = v_m),
          v_old_terminal_color)
  returning id into v_new_position0_id;

  insert into qr_codes (ministry_id, group_id, label, image_path, flow_type)
  values (v_m, v_new_position0_id, (select name from groups where id = v_new_position0_id), '', 'intake_only');

  insert into audit_log (ministry_id, user_id, action_type, details)
  values (v_m, auth.uid(), 'GROUP_TRANSITION_RUN',
          jsonb_build_object('new_pre_entry_cohort_year', new_pre_entry_cohort_year,
                             'new_terminal_group_id', v_new_terminal_group.id,
                             'archived_old_terminal_group_id', v_old_terminal_group_id));
end
$$;

create or replace function archive_audit_log(cutoff_date date)
returns integer language plpgsql security definer as $$
declare
  v_m text := current_ministry_id();
  v_deleted integer;
begin
  if not is_admin_in(v_m) then raise exception 'Only Admins can archive audit log entries'; end if;
  -- This ministry's entries only (plan §2.5 #9).
  delete from audit_log where ministry_id = v_m and occurred_at < cutoff_date;
  get diagnostics v_deleted = row_count;
  return v_deleted;
end
$$;

create or replace function grant_servant_role(p_user_id uuid, p_role app_role, p_group_id uuid)
returns uuid language plpgsql security definer as $$
declare
  v_m text := current_ministry_id();
  v_new_id uuid;
begin
  if not is_admin_or_gc_in(v_m) then raise exception 'Only General Coordinators/Admins can grant a role here'; end if;
  if p_role not in ('servant', 'sub_coordinator', 'read_only') then
    raise exception 'Only Servant, Sub-Coordinator, or Read-Only grants can be added here -- use Access Maintenance for Admin/General Coordinator roles';
  end if;
  if p_group_id is not null and not exists (select 1 from groups where id = p_group_id and ministry_id = v_m) then
    raise exception 'Group not found';
  end if;
  if not exists (select 1 from user_roles where ministry_id = v_m and user_id = p_user_id) then
    raise exception 'This person has no existing role grant yet -- use Access Maintenance to grant their first one';
  end if;
  if exists (select 1 from user_roles where ministry_id = v_m and user_id = p_user_id and role = p_role
             and group_id is not distinct from p_group_id) then
    raise exception 'This person already holds that exact role/group grant';
  end if;

  insert into user_roles (ministry_id, user_id, role, group_id) values (v_m, p_user_id, p_role, p_group_id)
  returning id into v_new_id;
  return v_new_id;
end
$$;

create or replace function reassign_role_group(p_role_id uuid, p_group_id uuid)
returns void language plpgsql security definer as $$
declare
  v_m text := current_ministry_id();
  v_role app_role;
begin
  if not is_admin_or_gc_in(v_m) then raise exception 'Only General Coordinators/Admins can reassign a role grant'; end if;
  select role into v_role from user_roles where id = p_role_id and ministry_id = v_m;
  if v_role is null then raise exception 'Role grant not found'; end if;
  if v_role <> 'servant' then raise exception 'Only Servant grants can be reassigned to a different group here'; end if;
  if p_group_id is not null and not exists (select 1 from groups where id = p_group_id and ministry_id = v_m) then
    raise exception 'Group not found';
  end if;
  update user_roles set group_id = p_group_id where id = p_role_id and ministry_id = v_m;
end
$$;

create or replace function revoke_role_grant(p_role_id uuid)
returns void language plpgsql security definer as $$
declare
  v_m text := current_ministry_id();
  v_role app_role; v_user_id uuid;
begin
  if not is_admin_or_gc_in(v_m) then raise exception 'Only General Coordinators/Admins can revoke a role grant'; end if;
  select role, user_id into v_role, v_user_id from user_roles where id = p_role_id and ministry_id = v_m;
  if v_role is null then raise exception 'Role grant not found'; end if;
  if v_role in ('admin', 'general_coordinator') then
    raise exception 'Admin and General Coordinator grants can only be revoked from Access Maintenance';
  end if;
  if v_role = 'servant' then
    update members set assigned_servant_id = null, is_new_assignment = false
    where ministry_id = v_m and assigned_servant_id = v_user_id;
  end if;
  delete from user_roles where id = p_role_id and ministry_id = v_m;
end
$$;

create or replace function remove_servant(p_user_id uuid)
returns void language plpgsql security definer as $$
declare
  v_m text := current_ministry_id();
begin
  if not is_admin_or_gc_in(v_m) then raise exception 'Only General Coordinators/Admins can remove a servant'; end if;
  -- This ministry only (plan §2.5 #10).
  update members set assigned_servant_id = null, is_new_assignment = false
  where ministry_id = v_m and assigned_servant_id = p_user_id;
  delete from user_roles where ministry_id = v_m and user_id = p_user_id and role = 'servant';
end
$$;

create or replace function export_group_member_names(p_group_id uuid)
returns table(full_name text) language plpgsql security definer as $$
begin
  if not is_coordinator() then raise exception 'Only Coordinators/Admins can export a names list'; end if;
  return query
    select m.full_name from members m
    where m.ministry_id = current_ministry_id() and m.group_id = p_group_id and m.status = 'active'
    order by m.full_name;
end
$$;

create or replace function get_audit_log_users()
returns table(user_id uuid, full_name text) language plpgsql stable security definer as $$
#variable_conflict use_column
declare
  v_m text := current_ministry_id();
begin
  if not is_admin_in(v_m) then raise exception 'Only Admins can view audit log users'; end if;
  return query
    select distinct p.id, p.full_name
    from audit_log a
    join profiles p on p.ministry_id = a.ministry_id and p.id = a.user_id
    where a.ministry_id = v_m and a.user_id is not null;
end
$$;

create or replace function get_qr_codes_with_groups()
returns table(id uuid, label text, check_in_token uuid, printed_at timestamptz, updated_at timestamptz,
              group_id uuid, ladder_position integer, qr_color text)
language sql stable security definer as $$
  select q.id, q.label, q.check_in_token, q.printed_at, q.updated_at, q.group_id, g.ladder_position::integer, g.qr_color
  from qr_codes q
  left join groups g on g.id = q.group_id
  where q.ministry_id = current_ministry_id() and is_app_user();
$$;

create or replace function add_member_photo(p_member_id uuid, p_photo_path text)
returns boolean language plpgsql security definer as $$
declare
  v_group_id uuid; v_rows int;
begin
  select group_id into v_group_id from members where id = p_member_id and ministry_id = current_ministry_id();
  if v_group_id is null then raise exception 'Member not found'; end if;
  if not has_readonly_or_full_group_access(v_group_id) then raise exception 'Not authorized to view this member'; end if;
  update members set photo_path = p_photo_path where id = p_member_id and photo_path is null;
  get diagnostics v_rows = row_count;
  return v_rows > 0;
end
$$;

-- 9. Person-level functions (profiles are per ministry, D7) ----------------

create or replace function absorb_own_pending_registration()
returns void language plpgsql security definer as $$
declare
  v_uid uuid := auth.uid();
  v_m text := current_ministry_id();
  v_pending record;
begin
  if v_uid is null or v_m is null then return; end if;
  -- Only a request for THIS ministry, and only once they hold a role here
  -- (serving in one ministry must never close another's request).
  if not exists (select 1 from user_roles where ministry_id = v_m and user_id = v_uid) then return; end if;

  select id, phone, father_of_confession, gender into v_pending
  from pending_servants
  where ministry_id = v_m and submitted_by_profile_id = v_uid and resulting_profile_id is null
  order by submitted_at desc limit 1;
  if v_pending.id is null then return; end if;

  update profiles set
    phone = coalesce(profiles.phone, v_pending.phone),
    father_of_confession = coalesce(profiles.father_of_confession, v_pending.father_of_confession),
    gender = coalesce(profiles.gender, v_pending.gender)
  where ministry_id = v_m and id = v_uid;

  update pending_servants set resulting_profile_id = v_uid, approved_at = coalesce(approved_at, now())
  where id = v_pending.id;
end
$$;

create or replace function link_approved_pending_servant(p_email text)
returns void language plpgsql security definer as $$
declare
  v_uid uuid := auth.uid();
  v_m text := current_ministry_id();
  v_pending record;
begin
  if v_uid is null or v_m is null then return; end if;

  select id, phone, father_of_confession, gender into v_pending
  from pending_servants
  where ministry_id = v_m and approved_at is not null and resulting_profile_id is null
    and (submitted_by_profile_id = v_uid or (p_email is not null and lower(email) = lower(p_email)))
  order by (submitted_by_profile_id = v_uid) desc, submitted_at asc
  limit 1;
  if v_pending.id is null then return; end if;
  if not exists (select 1 from profiles where ministry_id = v_m and id = v_uid) then return; end if;

  if not exists (select 1 from user_roles where ministry_id = v_m and user_id = v_uid and role = 'servant') then
    insert into user_roles (ministry_id, user_id, role, group_id) values (v_m, v_uid, 'servant', null);
  end if;

  update profiles set
    phone = coalesce(profiles.phone, v_pending.phone),
    father_of_confession = coalesce(profiles.father_of_confession, v_pending.father_of_confession),
    gender = coalesce(profiles.gender, v_pending.gender)
  where ministry_id = v_m and id = v_uid;

  insert into attendance_records (ministry_id, attendee_type, servant_id, service_date)
  select v_m, 'servant', v_uid, psa.service_date
  from pending_servant_attendance psa
  where psa.pending_servant_id = v_pending.id and psa.ministry_id = v_m
  on conflict (ministry_id, servant_id, service_date) do nothing;

  update pending_servants set resulting_profile_id = v_uid where id = v_pending.id;
end
$$;

create or replace function submit_own_servant_registration(
  p_phone text, p_gender text, p_father_of_confession text default null, p_comments text default null)
returns uuid language plpgsql security definer as $$
declare
  v_uid uuid := auth.uid();
  v_m text := current_ministry_id();
  v_email text; v_full_name text; v_pending_id uuid;
begin
  if v_uid is null then raise exception 'Not signed in'; end if;
  if not ministry_exists(v_m) then raise exception 'Unknown ministry'; end if;

  select email, full_name into v_email, v_full_name from profiles where ministry_id = v_m and id = v_uid;
  if v_full_name is null then raise exception 'Profile not found'; end if;

  update pending_servants
  set phone = p_phone, gender = p_gender, father_of_confession = p_father_of_confession, registration_comments = p_comments
  where ministry_id = v_m and submitted_by_profile_id = v_uid and resulting_profile_id is null
  returning id into v_pending_id;

  if v_pending_id is null then
    insert into pending_servants (ministry_id, full_name, phone, email, father_of_confession, gender, registration_comments, submitted_by_profile_id)
    values (v_m, v_full_name, p_phone, v_email, p_father_of_confession, p_gender, p_comments, v_uid)
    returning id into v_pending_id;
  end if;
  return v_pending_id;
end
$$;

create or replace function merge_servant_accounts(p_keep_id uuid, p_remove_id uuid)
returns void language plpgsql security definer as $$
declare
  v_m text := current_ministry_id();
  v_keep_join date; v_remove_join date;
begin
  if not is_admin_in(v_m) then raise exception 'Only System Admins can merge accounts'; end if;
  if p_keep_id = p_remove_id then raise exception 'Cannot merge an account into itself'; end if;
  if not exists (select 1 from profiles where ministry_id = v_m and id = p_keep_id) then
    raise exception 'The account to keep was not found';
  end if;
  if not exists (select 1 from profiles where ministry_id = v_m and id = p_remove_id) then
    raise exception 'The account to merge away was not found';
  end if;

  -- Everything below is limited to this ministry; the same people's
  -- profiles and history in other ministries are untouched.
  delete from attendance_records ar
  where ar.ministry_id = v_m and ar.servant_id = p_remove_id
    and exists (select 1 from attendance_records k
                where k.ministry_id = v_m and k.servant_id = p_keep_id and k.service_date = ar.service_date);
  update attendance_records     set servant_id = p_keep_id  where ministry_id = v_m and servant_id = p_remove_id;
  update outreach_entries       set servant_id = p_keep_id  where ministry_id = v_m and servant_id = p_remove_id;
  update service_calendar_events set created_by = p_keep_id where ministry_id = v_m and created_by = p_remove_id;
  update pending_servants set approved_by = p_keep_id where ministry_id = v_m and approved_by = p_remove_id;
  update pending_servants set resulting_profile_id = p_keep_id where ministry_id = v_m and resulting_profile_id = p_remove_id;
  update pending_servants set submitted_by_profile_id = p_keep_id where ministry_id = v_m and submitted_by_profile_id = p_remove_id;
  update holiday_rules   set created_by = p_keep_id where ministry_id = v_m and created_by = p_remove_id;
  update audit_log       set user_id = p_keep_id    where ministry_id = v_m and user_id = p_remove_id;
  update members         set assigned_servant_id = p_keep_id where ministry_id = v_m and assigned_servant_id = p_remove_id;

  delete from user_roles ur
  where ur.ministry_id = v_m and ur.user_id = p_remove_id
    and exists (select 1 from user_roles k
                where k.ministry_id = v_m and k.user_id = p_keep_id and k.role = ur.role
                  and k.group_id is not distinct from ur.group_id);
  update user_roles set user_id = p_keep_id where ministry_id = v_m and user_id = p_remove_id;

  select join_date into v_keep_join from profiles where ministry_id = v_m and id = p_keep_id;
  select join_date into v_remove_join from profiles where ministry_id = v_m and id = p_remove_id;
  update profiles set join_date = least(v_keep_join, v_remove_join) where ministry_id = v_m and id = p_keep_id;

  delete from profiles where ministry_id = v_m and id = p_remove_id;
end
$$;

create or replace function remove_profile_completely(p_profile_id uuid)
returns void language plpgsql security definer as $$
declare
  v_m text := current_ministry_id();
  v_blockers text[] := array[]::text[];
  v_count int;
begin
  if not is_admin_in(v_m) then raise exception 'Only System Admins can remove a person''s record'; end if;
  if not exists (select 1 from profiles where ministry_id = v_m and id = p_profile_id) then
    raise exception 'Person not found';
  end if;

  select count(*) into v_count from attendance_records where ministry_id = v_m and servant_id = p_profile_id;
  if v_count > 0 then v_blockers := array_append(v_blockers, v_count || ' attendance record(s)'); end if;
  select count(*) into v_count from outreach_entries where ministry_id = v_m and servant_id = p_profile_id;
  if v_count > 0 then v_blockers := array_append(v_blockers, v_count || ' outreach entr' || (case when v_count = 1 then 'y' else 'ies' end)); end if;
  select count(*) into v_count from service_calendar_events where ministry_id = v_m and created_by = p_profile_id;
  if v_count > 0 then v_blockers := array_append(v_blockers, v_count || ' calendar event(s) created'); end if;
  select count(*) into v_count from pending_servants
  where ministry_id = v_m and (approved_by = p_profile_id or resulting_profile_id = p_profile_id);
  if v_count > 0 then v_blockers := array_append(v_blockers, v_count || ' pending-servant record(s) linked'); end if;
  select count(*) into v_count from holiday_rules where ministry_id = v_m and created_by = p_profile_id;
  if v_count > 0 then v_blockers := array_append(v_blockers, v_count || ' holiday rule(s) created'); end if;

  if array_length(v_blockers, 1) > 0 then
    raise exception 'Cannot remove -- this person has real history: %', array_to_string(v_blockers, ', ');
  end if;

  -- This ministry's record only; the person's login and any other
  -- ministry's profile are untouched.
  update members set assigned_servant_id = null, is_new_assignment = false
  where ministry_id = v_m and assigned_servant_id = p_profile_id;
  delete from audit_log where ministry_id = v_m and user_id = p_profile_id;
  delete from profiles where ministry_id = v_m and id = p_profile_id;
end
$$;

-- "Add existing account by email" (plan §3.7): gives someone who already
-- has a login a profile in this ministry, with no role yet.
create or replace function add_person_to_ministry_by_email(p_email text)
returns uuid language plpgsql security definer as $$
declare
  v_m text := current_ministry_id();
  v_user record;
begin
  if not is_admin_in(v_m) then raise exception 'Only Admins can add people'; end if;
  select u.id, u.email, u.raw_user_meta_data as meta into v_user
  from auth.users u where lower(u.email) = lower(trim(p_email)) limit 1;
  if v_user.id is null then
    raise exception 'No account with that email -- ask them to sign in once first';
  end if;
  insert into profiles (ministry_id, id, full_name, email)
  values (v_m, v_user.id,
          coalesce(v_user.meta ->> 'full_name', v_user.meta ->> 'name', v_user.email, 'Unnamed User'),
          v_user.email)
  on conflict (ministry_id, id) do nothing;
  return v_user.id;
end
$$;

-- 10. Triggers --------------------------------------------------------------

create or replace function clear_new_assignment_on_outreach()
returns trigger language plpgsql as $$
begin
  update members set is_new_assignment = false
  where id = new.member_id and ministry_id = new.ministry_id and is_new_assignment = true;
  return new;
end
$$;

create or replace function update_join_date_on_attendance()
returns trigger language plpgsql as $$
begin
  if new.attendee_type = 'member' then
    update members set join_date = new.service_date
    where id = new.member_id and ministry_id = new.ministry_id and (join_date is null or join_date > new.service_date);
  elsif new.attendee_type = 'servant' then
    update profiles set join_date = new.service_date
    where id = new.servant_id and ministry_id = new.ministry_id and (join_date is null or join_date > new.service_date);
  end if;
  return new;
end
$$;

-- F12: only when that ministry's setting is on (default on; SAY stays on).
create or replace function ensure_servant_for_sub_coordinator()
returns trigger language plpgsql security definer as $$
begin
  if new.role = 'sub_coordinator'
     and coalesce((select sub_coordinator_auto_servant from app_settings where ministry_id = new.ministry_id), true) then
    insert into user_roles (ministry_id, user_id, role, group_id)
    values (new.ministry_id, new.user_id, 'servant', new.group_id)
    on conflict (ministry_id, user_id, role, group_id) do nothing;
  end if;
  return new;
end
$$;

-- 11. Church Admin console functions (plan §3.8) ---------------------------

create or replace function list_ministries()
returns table(id text, name text, is_active boolean, display_order integer, created_at timestamptz,
              admin_count integer, addresses text[])
language plpgsql stable security definer as $$
begin
  if not is_church_admin() then raise exception 'Church Admins only'; end if;
  return query
    select m.id, m.name, m.is_active, m.display_order, m.created_at,
           (select count(*)::int from user_roles ur where ur.ministry_id = m.id and ur.role = 'admin'),
           coalesce((select array_agg(a.host order by a.host) from ministry_addresses a where a.ministry_id = m.id), '{}')
    from ministries m
    order by m.display_order, m.id;
end
$$;

-- Applies a JSON object of App Settings values (only known columns; the
-- ministry code itself can never be changed this way).
create or replace function apply_ministry_settings(p_ministry_id text, p_settings jsonb)
returns void language plpgsql security definer as $$
declare
  v jsonb := coalesce(p_settings, '{}'::jsonb) - 'ministry_id' - 'id' - 'updated_at' - 'app_version';
begin
  if not is_church_admin() then raise exception 'Church Admins only'; end if;
  update app_settings s set
    (app_title_long, app_title_short, app_subtitle, logo_url, theme_color, theme_color_light, theme_color_dark,
     servants_qr_color, my_assigned_header_color, my_assigned_header_color_light, group_label, member_label,
     group_name_template, same_day_cutoff_time, timezone, service_weekday, youth_attendance_window_weeks,
     servant_attendance_window_weeks, birthday_window_days_before, birthday_window_days_after, university_label,
     program_label, proximity_enabled, show_proximity_on_attendance, actions_needed_lookback_months,
     ladder_position_label, sub_coordinator_auto_servant)
  = (select r.app_title_long, r.app_title_short, r.app_subtitle, r.logo_url, r.theme_color, r.theme_color_light, r.theme_color_dark,
            r.servants_qr_color, r.my_assigned_header_color, r.my_assigned_header_color_light, r.group_label, r.member_label,
            r.group_name_template, r.same_day_cutoff_time, r.timezone, r.service_weekday, r.youth_attendance_window_weeks,
            r.servant_attendance_window_weeks, r.birthday_window_days_before, r.birthday_window_days_after, r.university_label,
            r.program_label, r.proximity_enabled, r.show_proximity_on_attendance, r.actions_needed_lookback_months,
            r.ladder_position_label, r.sub_coordinator_auto_servant
     from jsonb_populate_record(s, v) r)
  where s.ministry_id = p_ministry_id;
  if not found then raise exception 'Ministry % not found', p_ministry_id; end if;
end
$$;

create or replace function create_ministry(
  p_id text, p_name text, p_addresses text[], p_admin_emails text[], p_pre_entry_group_name text,
  p_settings jsonb default '{}'::jsonb, p_copy_from text default null)
returns void language plpgsql security definer as $$
declare
  v_email text;
  v_user record;
  v_group_id uuid;
  v_host text;
begin
  if not is_church_admin() then raise exception 'Church Admins only'; end if;
  if p_id is null or p_id !~ '^[A-Z]{3}$' then raise exception 'The ministry code must be exactly 3 capital letters'; end if;
  if exists (select 1 from ministries where id = p_id) then raise exception 'The code % is already used', p_id; end if;
  if nullif(trim(p_name), '') is null then raise exception 'Name is required'; end if;
  if nullif(trim(p_pre_entry_group_name), '') is null then raise exception 'A name for the first (pre-entry) group is required'; end if;
  if coalesce(array_length(p_admin_emails, 1), 0) not between 1 and 2 then raise exception 'Give 1 or 2 first Admins'; end if;
  if p_copy_from is not null and not exists (select 1 from ministries where id = p_copy_from) then
    raise exception 'Ministry % to copy from was not found', p_copy_from;
  end if;

  insert into ministries (id, name, display_order)
  values (p_id, trim(p_name), (select coalesce(max(display_order), 0) + 1 from ministries));

  insert into app_settings (ministry_id, app_title_long, app_title_short)
  values (p_id, trim(p_name), trim(p_name));
  perform apply_ministry_settings(p_id, p_settings);

  insert into audit_config (ministry_id, action_type, enabled, description)
  select p_id, t, true,
         (select c.description from audit_config c where c.ministry_id = coalesce(p_copy_from, 'SAY') and c.action_type = t)
  from unnest(enum_range(null::audit_action_type)) t;

  insert into actions_needed_config (ministry_id, proximity, min_presence_count, min_absence_weeks, min_outreach_weeks)
  values (p_id, 'Local', 0, 3, 4), (p_id, 'Regional', 0, 3, 4), (p_id, 'Abroad', 0, 6, 4), (p_id, 'Unknown', 0, 3, 4);

  insert into groups (ministry_id, cohort_year, ladder_position, name, display_order)
  values (p_id, null, 0, trim(p_pre_entry_group_name), 1)
  returning id into v_group_id;
  insert into qr_codes (ministry_id, group_id, label, image_path, flow_type)
  values (p_id, v_group_id, trim(p_pre_entry_group_name), '', 'intake_only');
  insert into qr_codes (ministry_id, group_id, label, image_path)
  values (p_id, null, trim(p_name) || ' Servants', '');

  foreach v_host in array coalesce(p_addresses, '{}') loop
    insert into ministry_addresses (host, ministry_id, kind) values (lower(trim(v_host)), p_id, 'ministry');
  end loop;

  foreach v_email in array p_admin_emails loop
    select u.id, u.email, u.raw_user_meta_data as meta into v_user
    from auth.users u where lower(u.email) = lower(trim(v_email)) limit 1;
    if v_user.id is null then
      raise exception 'No account for % -- ask them to sign in once first', v_email;
    end if;
    insert into profiles (ministry_id, id, full_name, email)
    values (p_id, v_user.id, coalesce(v_user.meta ->> 'full_name', v_user.meta ->> 'name', v_user.email), v_user.email)
    on conflict (ministry_id, id) do nothing;
    insert into user_roles (ministry_id, user_id, role, group_id) values (p_id, v_user.id, 'admin', null)
    on conflict do nothing;
  end loop;

  -- D4: copies, never shared.
  if p_copy_from is not null then
    insert into verses (ministry_id, text, reference, is_active)
    select p_id, text, reference, is_active from verses where ministry_id = p_copy_from;
    insert into holiday_rules (ministry_id, title, basis, start_month, start_day, start_offset, duration_days, is_active, created_by)
    select p_id, title, basis, start_month, start_day, start_offset, duration_days, is_active, null
    from holiday_rules where ministry_id = p_copy_from;
  end if;
end
$$;

create or replace function update_ministry(p_id text, p_name text, p_display_order integer)
returns void language plpgsql security definer as $$
begin
  if not is_church_admin() then raise exception 'Church Admins only'; end if;
  update ministries set name = coalesce(nullif(trim(p_name), ''), name), display_order = coalesce(p_display_order, display_order)
  where id = p_id;
  if not found then raise exception 'Ministry % not found', p_id; end if;
end
$$;

create or replace function set_ministry_active(p_id text, p_active boolean)
returns void language plpgsql security definer as $$
begin
  if not is_church_admin() then raise exception 'Church Admins only'; end if;
  update ministries set is_active = p_active where id = p_id;
  if not found then raise exception 'Ministry % not found', p_id; end if;
end
$$;

create or replace function add_ministry_address(p_host text, p_ministry_id text)
returns void language plpgsql security definer as $$
begin
  if not is_church_admin() then raise exception 'Church Admins only'; end if;
  insert into ministry_addresses (host, ministry_id, kind)
  values (lower(trim(p_host)), p_ministry_id, case when p_ministry_id is null then 'console' else 'ministry' end);
end
$$;

create or replace function remove_ministry_address(p_host text)
returns void language plpgsql security definer as $$
begin
  if not is_church_admin() then raise exception 'Church Admins only'; end if;
  delete from ministry_addresses where host = lower(trim(p_host));
end
$$;

-- 12. Security rules (RLS) -----------------------------------------------
-- Every rule on a per-ministry table: "row is in the current ministry" AND
-- today's rule. Row-independent helper calls are wrapped in (select ...)
-- so Postgres evaluates them once per query, not once per row.

do $$
declare
  r record;
begin
  for r in
    select tablename, policyname from pg_policies
    where schemaname = current_schema()
      and tablename in ('actions_needed_config', 'app_releases', 'app_settings', 'attendance_records', 'audit_config',
                        'audit_log', 'groups', 'holiday_rules', 'members', 'outreach_entries', 'pending_servant_attendance',
                        'pending_servants', 'profiles', 'qr_codes', 'service_calendar_events', 'universities',
                        'user_roles', 'verses')
  loop
    execute format('drop policy %I on %I', r.policyname, r.tablename);
  end loop;
end
$$;

create policy actions_needed_config_select on actions_needed_config for select
  using (ministry_id = (select current_ministry_id()) and (select is_app_user()));
create policy actions_needed_config_write on actions_needed_config for all
  using (ministry_id = (select current_ministry_id()) and (select is_admin()))
  with check (ministry_id = (select current_ministry_id()) and (select is_admin()));

create policy app_releases_select on app_releases for select using (true);
create policy app_releases_write on app_releases for all
  using ((select is_church_admin())) with check ((select is_church_admin()));

-- Readable without signing in (login page branding) -- this ministry only.
create policy app_settings_select on app_settings for select
  using (ministry_id = (select current_ministry_id()));
create policy app_settings_write on app_settings for update
  using (ministry_id = (select current_ministry_id()) and (select is_admin()))
  with check (ministry_id = (select current_ministry_id()) and (select is_admin()));

create policy attendance_select on attendance_records for select
  using (ministry_id = (select current_ministry_id()) and (
    (attendee_type = 'member' and ((select is_admin_or_general_coordinator())
        or has_readonly_or_full_group_access((select m.group_id from members m where m.id = attendance_records.member_id))))
    or (attendee_type = 'servant' and (select is_app_user()))));
create policy attendance_insert on attendance_records for insert
  with check (ministry_id = (select current_ministry_id()) and (
    (attendee_type = 'member' and ((select is_admin_or_general_coordinator())
        or has_group_access((select m.group_id from members m where m.id = attendance_records.member_id))))
    or (attendee_type = 'servant' and (select is_coordinator()))));
create policy attendance_delete on attendance_records for delete
  using (ministry_id = (select current_ministry_id()) and (
    (attendee_type = 'member' and ((select is_admin_or_general_coordinator())
        or has_group_access((select m.group_id from members m where m.id = attendance_records.member_id))))
    or (attendee_type = 'servant' and (select is_coordinator()))));

create policy audit_config_admin_only on audit_config for all
  using (ministry_id = (select current_ministry_id()) and (select is_admin()))
  with check (ministry_id = (select current_ministry_id()) and (select is_admin()));

create policy audit_log_insert on audit_log for insert
  with check (ministry_id = (select current_ministry_id()) and (select is_app_user()));
create policy audit_log_select on audit_log for select
  using (ministry_id = (select current_ministry_id()) and (select is_admin()));

create policy groups_select on groups for select
  using (ministry_id = (select current_ministry_id()) and (
    (ladder_position = 0 and (select is_admin()))
    or (ladder_position > 0 and ((select is_app_user()) or has_group_access(id)))));
create policy groups_admin_write on groups for all
  using (ministry_id = (select current_ministry_id()) and (select is_admin()))
  with check (ministry_id = (select current_ministry_id()) and (select is_admin()));

create policy holiday_rules_admin_only on holiday_rules for all
  using (ministry_id = (select current_ministry_id()) and (select is_admin()))
  with check (ministry_id = (select current_ministry_id()) and (select is_admin()));

create policy members_select on members for select
  using (ministry_id = (select current_ministry_id())
         and ((select is_admin_or_general_coordinator()) or has_readonly_or_full_group_access(group_id)));
create policy members_insert on members for insert
  with check (ministry_id = (select current_ministry_id())
              and ((select is_admin_or_general_coordinator()) or has_group_access(group_id)));
create policy members_update on members for update
  using (ministry_id = (select current_ministry_id())
         and ((select is_admin_or_general_coordinator()) or has_group_access(group_id)));
create policy members_delete on members for delete
  using (ministry_id = (select current_ministry_id()) and (select is_admin_or_general_coordinator()));

create policy outreach_select on outreach_entries for select
  using (ministry_id = (select current_ministry_id()) and ((select is_admin_or_general_coordinator())
         or has_readonly_or_full_group_access((select m.group_id from members m where m.id = outreach_entries.member_id))));
create policy outreach_insert on outreach_entries for insert
  with check (ministry_id = (select current_ministry_id()) and ((select is_admin_or_general_coordinator())
              or has_group_access((select m.group_id from members m where m.id = outreach_entries.member_id))));
create policy outreach_update on outreach_entries for update
  using (ministry_id = (select current_ministry_id()) and servant_id = (select auth.uid()))
  with check (ministry_id = (select current_ministry_id()) and servant_id = (select auth.uid()));
create policy outreach_delete on outreach_entries for delete
  using (ministry_id = (select current_ministry_id()) and servant_id = (select auth.uid()));

create policy pending_servant_attendance_select on pending_servant_attendance for select
  using (ministry_id = (select current_ministry_id()) and (select is_admin_or_general_coordinator()));

create policy pending_servants_select on pending_servants for select
  using (ministry_id = (select current_ministry_id())
         and ((select is_admin_or_general_coordinator()) or submitted_by_profile_id = (select auth.uid())));
create policy pending_servants_update on pending_servants for update
  using (ministry_id = (select current_ministry_id()) and (select is_admin_or_general_coordinator()))
  with check (ministry_id = (select current_ministry_id()) and (select is_admin_or_general_coordinator()));
create policy pending_servants_delete on pending_servants for delete
  using (ministry_id = (select current_ministry_id()) and (select is_admin_or_general_coordinator()));

create policy profiles_select on profiles for select
  using (ministry_id = (select current_ministry_id()) and ((select is_app_user()) or id = (select auth.uid())));
create policy profiles_insert on profiles for insert
  with check (ministry_id = (select current_ministry_id()) and id = (select auth.uid()));
create policy profiles_update on profiles for update
  using (ministry_id = (select current_ministry_id()) and (id = (select auth.uid()) or (select is_coordinator())))
  with check (ministry_id = (select current_ministry_id()) and (id = (select auth.uid()) or (select is_coordinator())));

create policy qr_codes_select on qr_codes for select
  using (ministry_id = (select current_ministry_id()) and (select is_app_user()));
create policy qr_codes_write on qr_codes for all
  using (ministry_id = (select current_ministry_id()) and (select is_admin_or_general_coordinator()))
  with check (ministry_id = (select current_ministry_id()) and (select is_admin_or_general_coordinator()));

create policy calendar_select on service_calendar_events for select
  using (ministry_id = (select current_ministry_id()) and (select is_app_user()));
create policy calendar_write on service_calendar_events for all
  using (ministry_id = (select current_ministry_id()) and (select is_app_user()))
  with check (ministry_id = (select current_ministry_id()) and (select is_app_user()));

-- Readable without signing in (check-in school list) -- this ministry only.
create policy universities_select on universities for select
  using (ministry_id = (select current_ministry_id()));
create policy universities_write on universities for all
  using (ministry_id = (select current_ministry_id()) and (select is_admin()))
  with check (ministry_id = (select current_ministry_id()) and (select is_admin()));

create policy user_roles_select on user_roles for select
  using (ministry_id = (select current_ministry_id()) and ((select is_app_user()) or user_id = (select auth.uid())));
create policy user_roles_admin_write on user_roles for all
  using (ministry_id = (select current_ministry_id()) and (select is_admin()))
  with check (ministry_id = (select current_ministry_id()) and (select is_admin()));

create policy verses_select on verses for select
  using (ministry_id = (select current_ministry_id()) and (select is_app_user()));
create policy verses_write on verses for all
  using (ministry_id = (select current_ministry_id()) and (select is_admin()))
  with check (ministry_id = (select current_ministry_id()) and (select is_admin()));

-- 13. Function privileges and pinned search_path ---------------------------

do $$
declare
  f record;
  v_schema text := current_schema();
  -- Callable without signing in: the public check-in flow, the address
  -- lookup, and the side-effect-free helpers the security rules call
  -- (a rule runs its functions with the caller's own privileges).
  v_anon text[] := array[
    'checkin_get_flow', 'checkin_list_members', 'checkin_list_servants', 'checkin_mark_attendance',
    'checkin_fill_missing_member_fields', 'checkin_find_possible_duplicate_member', 'checkin_resolve_duplicate_member',
    'checkin_submit_new_member', 'checkin_submit_new_servant', 'checkin_mark_servant_attendance',
    'checkin_mark_pending_servant_attendance', 'checkin_undo_attendance', 'checkin_undo_servant_attendance',
    'checkin_undo_pending_servant_attendance', 'checkin_today', 'is_service_day',
    'resolve_ministry_by_address',
    'current_ministry_id', 'is_church_admin', 'ministry_is_active', 'ministry_exists', 'is_app_user_in', 'is_admin_in',
    'is_admin_or_gc_in', 'is_coordinator_in', 'is_app_user', 'is_admin', 'is_admin_or_general_coordinator',
    'is_coordinator', 'can_manage_servants', 'has_group_access', 'has_readonly_or_full_group_access', 'group_ministry_id'];
  -- Internal only (called from other functions or triggers).
  v_internal text[] := array[
    'checkin_resolve', 'ministries_id_is_permanent', 'set_updated_at',
    'clear_new_assignment_on_outreach', 'update_join_date_on_attendance', 'ensure_servant_for_sub_coordinator'];
begin
  for f in
    select p.oid::regprocedure as sig, p.proname
    from pg_proc p where p.pronamespace = v_schema::regnamespace
  loop
    execute format('revoke all on function %s from public, anon, authenticated', f.sig);
    execute format('grant execute on function %s to service_role', f.sig);
    if f.proname = any (v_anon) then
      execute format('grant execute on function %s to anon, authenticated', f.sig);
    elsif not (f.proname = any (v_internal)) then
      execute format('grant execute on function %s to authenticated', f.sig);
    end if;
    -- Every function runs with this schema pinned, whoever calls it.
    execute format('alter function %s set search_path = %I, public, pg_temp', f.sig, v_schema);
  end loop;
end
$$;

-- 14. Post-checks (abort the whole transaction on any surprise) ------------

do $$
declare
  v_bad text;
begin
  -- Every per-ministry table: RLS on, and every rule mentions the ministry.
  select string_agg(p.tablename || '.' || p.policyname, ', ') into v_bad
  from pg_policies p
  where p.schemaname = current_schema()
    and p.tablename not in ('app_releases')
    and coalesce(p.qual, '') || coalesce(p.with_check, '') not like '%current_ministry_id()%';
  if v_bad is not null then raise exception 'Rules without the ministry condition: %', v_bad; end if;

  select string_agg(c.relname, ', ') into v_bad
  from pg_class c join pg_namespace n on n.oid = c.relnamespace
  where n.nspname = current_schema() and c.relkind = 'r' and not c.relrowsecurity;
  if v_bad is not null then raise exception 'Tables without row-level security: %', v_bad; end if;

  -- Nothing lost: every existing row now belongs to SAY.
  if exists (select 1 from app_settings where ministry_id <> 'SAY')
     or (select count(*) from app_settings) <> 1 then
    raise exception 'app_settings is not exactly one SAY row';
  end if;
  if (select count(*) from church_admins) <> 1 then
    raise exception 'Expected exactly one Church Admin';
  end if;
  if current_ministry_id() is distinct from 'SAY' then
    raise exception 'Transition fallback is not SAY';
  end if;
end
$$;

notify pgrst, 'reload schema';
