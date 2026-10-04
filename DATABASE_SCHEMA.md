# Youth Ministry Management App — Database Schema

**Companion to REQUIREMENTS.md.** This is the implementable Postgres/Supabase schema: tables, types, constraints, indexes, and representative Row-Level Security policies. It began as the original design artifact; the live schema is what `supabase/migrations/` builds (0001 → 0067), applied to both the `qa` and `prod` schemas.

> **Group ladder (0069–0070, built 30 Sep 2026).** Section L describes the group kinds, hidden groups, shared check-in codes and the new Group Transition, and takes precedence over §2 and §15.
>
> **Multi-ministry (v6, 29 Sep 2026).** Since Project B (migrations 0064–0067) the schema holds several ministries of one church. **Section M below is authoritative for that layer** and takes precedence over the single-ministry DDL in §1–§17, which is kept as the design record of each table's own columns. Wherever a table below shows a single-column key or a link to `profiles(id)`, read it together with §M: every ministry-owned table now has `ministry_id`, keys and uniqueness are per ministry, and links are composite. Design reasoning: `MULTI_TENANT_PLAN.md`.

---

## M. Multi-ministry layer (migrations 0064–0067)

### M.1 Church-wide tables (0064)

None of these is reachable through the API directly (RLS on, no policies, privileges revoked from `anon`/`authenticated`); they are read only through the narrow functions in M.5.

```sql
create table ministries (
  id            text primary key check (id ~ '^[A-Z]{3}$'),   -- the permanent 3-letter code, e.g. 'SAY'
  name          text not null check (length(trim(name)) > 0),
  is_active     boolean not null default true,
  display_order integer not null default 0,
  created_at    timestamptz not null default now()
);
-- trigger trg_ministries_id_permanent refuses any change to id

create table ministry_addresses (          -- this schema's environment only (qa or prod)
  host        text primary key check (host = lower(host) and host !~ '[/\s]'),
  ministry_id text references ministries(id),
  kind        text not null check (kind in ('ministry', 'console')),
  created_at  timestamptz not null default now(),
  check ((kind = 'console') = (ministry_id is null))
);

create table church_admins (
  user_id    uuid primary key references auth.users(id) on delete cascade,
  created_at timestamptz not null default now()
);

create table tenancy_settings (            -- one row
  id                  boolean primary key default true check (id),
  default_ministry_id text references ministries(id)  -- transition fallback; NULL since 0066 (fail closed)
);
```

`app_releases` (Release History) stays church-wide: readable by everyone, writable by the Church Admin only.

### M.2 `ministry_id` on 17 tables (0064)

`app_settings`, `groups`, `members`, `universities`, `attendance_records`, `outreach_entries`, `service_calendar_events`, `holiday_rules`, `verses`, `qr_codes`, `pending_servants`, `pending_servant_attendance`, `audit_log`, `audit_config`, `actions_needed_config`, `user_roles`, `profiles` each have:

```sql
ministry_id text not null default current_ministry_id() references ministries(id)
```

Inserts therefore need no code change: the column defaults to the request's ministry, and the composite keys below reject any mismatch. Database functions always set it explicitly.

### M.3 Keys, uniqueness and composite foreign keys (0064)

| Table | Key / uniqueness | Composite FKs (all include `ministry_id`) |
|---|---|---|
| `profiles` | PK `(ministry_id, id)` — **one profile per person per ministry**; `id` is still the login id | – |
| `app_settings` | PK `ministry_id` (singleton `id` dropped in 0066); adds `sub_coordinator_auto_servant boolean not null default true` | – |
| `groups` | `unique (ministry_id, id)`, `unique (ministry_id, cohort_year)` | – |
| `members` | `unique (ministry_id, id)` | `(ministry_id, group_id) → groups`, `(ministry_id, university_id) → universities`, `(ministry_id, assigned_servant_id) → profiles` |
| `universities` | `unique (ministry_id, id)`, `unique (ministry_id, name)` | – |
| `attendance_records` | `unique (ministry_id, servant_id, service_date)` | `(ministry_id, member_id) → members`, `(ministry_id, servant_id) → profiles` |
| `outreach_entries` | – | `(ministry_id, member_id) → members`, `(ministry_id, servant_id) → profiles` |
| `service_calendar_events`, `holiday_rules` | – | `(ministry_id, created_by) → profiles` |
| `qr_codes` | `check_in_token` stays unique church-wide (the anonymous check-in page finds the ministry from it); one Servants QR per ministry (`unique (ministry_id) where group_id is null`); `printed_at` dropped in 0066 | `(ministry_id, group_id) → groups` |
| `pending_servants` | `unique (ministry_id, id)`; one open self-registration per person per ministry | `(ministry_id, approved_by / resulting_profile_id / submitted_by_profile_id) → profiles` |
| `pending_servant_attendance` | – | `(ministry_id, pending_servant_id) → pending_servants` (cascade) |
| `audit_log` | – | `(ministry_id, group_id) → groups`, `(ministry_id, user_id) → profiles` |
| `audit_config` | PK `(ministry_id, action_type)` | – |
| `actions_needed_config` | PK `(ministry_id, proximity)` | – |
| `user_roles` | `unique (ministry_id, user_id, role, group_id)`; one Unassigned grant per person per ministry | `(ministry_id, group_id) → groups`, `(ministry_id, user_id) → profiles` (cascade) |

Every `legacy_source_ref` unique index is now `(ministry_id, legacy_source_ref)`. Ministry-first indexes were added for the busiest filters (attendance by date, audit log by time, members by group, outreach by member, roles by user, groups by position).

### M.4 How a request's ministry reaches the database

- The app resolves its web address to a ministry and sends the code in the `x-ministry-id` request header on every call.
- `current_ministry_id()` returns that header when it is exactly 3 letters A–Z, otherwise `tenancy_settings.default_ministry_id` (NULL since 0066, so a request that names no ministry sees nothing). It never raises.
- The header only narrows: every rule still requires a real role in that ministry.
- Public check-in functions ignore the header and use the ministry of the scanned QR code.

### M.5 Functions

- **Explicit-ministry helpers:** `is_church_admin(uid)`, `ministry_exists(m)`, `ministry_is_active(m)`, `is_app_user_in(m, uid)`, `is_admin_in(m, uid)`, `is_admin_or_gc_in(m, uid)`, `is_coordinator_in(m, uid)`, `group_ministry_id(gid)`. The Church Admin passes the role checks in every existing ministry; everyone else also needs the ministry to be active.
- **Existing helpers, same names and signatures,** now mean "in the current ministry": `is_app_user`, `is_admin`, `is_admin_or_general_coordinator`, `is_coordinator`, `can_manage_servants`, `has_group_access` (the group must belong to the current ministry), `has_readonly_or_full_group_access`.
- **`accessible_group_ids(p_include_read_only)`** (0067): the current user's accessible group ids in the current ministry, as one array, so security rules evaluate it once per query instead of once per row.
- **Address lookup:** `resolve_ministry_by_address(host)` returns `(ministry_id, name, is_active, kind)` for that one address, or nothing. It is callable without sign-in and has no "list all" form.
- **Check-in** (no sign-in): `checkin_resolve(token)` finds the QR code's ministry and refuses an inactive one. Every `checkin_*` function starts there and scopes every read and write to it, including service day and "today" (`is_service_day(m)`, `checkin_today(m)`). `checkin_get_flow` also returns `ministry_id`, so the page shows that ministry's branding and school list.
- **Admin, Coordinator and person-level functions** (`run_group_transition`, `add_group_tier`, `delete_group_tier`, `rename_group`, `archive_audit_log`, `grant_servant_role`, `reassign_role_group`, `revoke_role_grant`, `remove_servant`, `export_group_member_names`, `get_audit_log_users` and `get_audit_report_rows` (Admins and General Coordinators, 0071; the audit log table itself stays Admin-only), `get_qr_codes_with_groups`, `add_member_photo`, `merge_servant_accounts`, `remove_profile_completely`, `link_approved_pending_servant`, `absorb_own_pending_registration`) act only within the current ministry.
- **New:** `add_person_to_ministry_by_email(email)`, for an Admin of the current ministry.
- **Triggers:** `ensure_servant_for_sub_coordinator` respects the ministry's `sub_coordinator_auto_servant` setting; `update_join_date_on_attendance` updates that ministry's profile.
- **Console (Church Admin only):** `list_ministries`, `create_ministry`, `update_ministry`, `apply_ministry_settings`, `set_ministry_active`, `add_ministry_address`, `remove_ministry_address`.
- **Storage:** `storage_write_allowed(name, admin_only)`, see M.7.
- **Every** security-definer function has a pinned `search_path` (its own schema, `public`, `pg_temp`). Only the check-in functions and `resolve_ministry_by_address` are callable without sign-in.

### M.6 Row-Level Security pattern

Every rule on a per-ministry table starts with the ministry condition, then keeps the table's own rule, for example (production, as applied):

```sql
-- members: read
using ( ministry_id = (select current_ministry_id())
        and ( (select is_admin_or_general_coordinator())
              or group_id = any ((select accessible_group_ids(true))::uuid[]) ) )

-- members: insert/update use accessible_group_ids(false) (read-only grants excluded)

-- profiles: read = app users of this ministry, or yourself; update = yourself or a coordinator of this ministry;
--           insert = yourself, in this ministry
using ( ministry_id = (select current_ministry_id())
        and ( (select is_app_user()) or id = (select auth.uid()) ) )

-- app_settings: readable without sign-in, for the request's ministry only (login and check-in pages need it);
--               update = Admin of that ministry
using ( ministry_id = (select current_ministry_id()) )
```

Helpers are wrapped in `(select …)` so Postgres evaluates them once per query. The `::uuid[]` cast on `accessible_group_ids` is required: without it `= any (select …)` parses as a subquery comparison.

### M.7 Storage

Buckets per environment (`qa-photos`, `qa-calendar`, `qa-branding` and the `prod-*` equivalents) hold one folder per ministry: `SAY/members/…`, `SAY/profiles/…`, `SAY/calendar/…`, `SAY/branding/…`. The stored paths in `members.photo_path`, `profiles.photo_path`, `service_calendar_events.attachment_url` and `app_settings.logo_url` include the folder. A `photo_path` that is a web link (a Google profile picture saved at first sign-in) is left as is and shown directly.

Write policies (0065, a separate QA file and production file, so neither ever touches the other environment's rules) call `storage_write_allowed(name, admin_only)`. When the path's first folder is a ministry code, it allows the write only if the caller is an approved user of **that** ministry (for branding, its Admin) or the Church Admin; the folder decides, not the request header. Paths with no folder fall back to the pre-v6 rule for the current ministry; that branch existed for the transition, and the app now writes only folder paths. Any other shape is refused. Reading is unchanged: the buckets are public.

## A. Confidentiality agreement (migrations 0086a, 0086)

Church-wide (no `ministry_id`): one agreement, signed once by every app user whichever ministries they serve in.

| Table | Columns | Who can read |
| --- | --- | --- |
| `agreement_versions` | `id`, `version` (unique), `title`, `body` (headings `## `, bullets `- `, numbered `1. `, paragraphs), `published_at`, `resign_after_months` (null = never), `created_at` | Any signed-in user, published versions only |
| `agreement_signatures` | `id`, `user_id`, `version_id`, `typed_name`, `email` (from `auth.users`), `signed_at` (database clock), `ministry_id` (where signed) | The signer; an Admin/GC (past the authenticator step) of a ministry where the signer has a profile; the Church Admin. Nobody can insert, change or delete rows directly |
| `agreement_grace` | `user_id`, `grace_until` | No one through the API (functions only) |

The version in force is the latest `published_at <= now()`. A signature counts if it is for that version and, when `resign_after_months` is set, newer than that many months.

Functions (security definer, pinned `search_path`, signed-in users only):
- `agreement_gate()` → `must_sign`, `needs_signature`, `grace_until` for the caller; no row when nothing is published. The app's front door sends `must_sign` people to `/security/agreement` on every request, and reminds people in grace on page loads (at most daily, `agreement_later` cookie).
- `sign_agreement(version_id, typed_name)` → signature id. Refuses a version that isn't current and names outside 2–120 characters; returns the existing signature if already signed; writes an `AGREEMENT_SIGNED` audit entry under the signer (always recorded).
- `agreement_status_here()` → every profile in this ministry with its latest signature, `is_current` and `grace_until`; empty unless the caller is an Admin/GC here or the Church Admin.

0086 gave everyone with a SAY role at that moment 14 days of grace; everyone else must sign before using the app. Publishing new wording = inserting version N+1 (everyone signs again).

## P. Parents' contact details (migration 0087)

- `members` gains six optional text columns: `parent1_name`, `parent1_phone`, `parent1_email`, `parent2_name`, `parent2_phone`, `parent2_email` (check `members_parent_contacts_length`: names ≤ 80, phones ≤ 30, emails ≤ 254 characters). Signed-in users may update them (added to the 0084 column grants); reading follows the existing `members` rules.
- `app_settings.show_parent_contacts boolean not null default false` — per ministry, set in Ministry Settings. While false the app neither shows nor sends the fields, and the check-in functions ignore them.
- `parent_contacts_on(ministry_id)` and `checkin_check_parents(...)` (security definer, internal only): the switch, and the check-in rules for the six fields (letters-only names 2–80, phones with 7–15 digits, valid emails).
- The check-in functions take the six fields as extra, defaulted arguments: `checkin_submit_new_member` saves them; `checkin_resolve_duplicate_member` fills only blank ones and notes differences in `registration_comments`; `checkin_fill_missing_member_fields` fills only blank ones; `checkin_mark_attendance` also returns `missing_parent1_name` … `missing_parent2_email` (false while the switch is off).

## L. Group ladder (migrations 0069–0070)

`GROUP_LADDER_PLAN.md` v1.3. **Authoritative over §2, the `groups_select` policy in §7, §13's `flow_type` note and §15.**

### L.1 Columns

| Table | Column | Meaning |
|---|---|---|
| `groups` | `kind group_kind not null` | `pre_entry` (level 0; one active per ministry, `uq_groups_one_pre_entry`), `regular` (levels 1…N, several may share a level), `terminal` (the hidden hand-over group, stored at level N+1; one or more). Check: `(kind = 'pre_entry') = (ladder_position = 0)`. |
| `groups` | `name_pattern text` | Yearly name pattern re-applied at each transition (`{cohort_year}`, `{level}`, `{label}`, old spelling `{position_label}`, and since 0073 `{gender}`, `{patron_saint}`); null = the name never changes. |
| storage | `<env>-photos` bucket private (0075) | Read only through `storage_photo_read_allowed(name)`: a signed-in person who could see that youth/servant in the app; the app shows photos via `/api/photo` (hour-long signed links). Branding stays public. |
| `app_settings` | `checkin_opens_at time`, `checkin_closes_at time` | 0074: public check-in hours on the service day (default 00:00-23:59:59). |
| `groups` | `gender_label text`, `patron_saint text` | 0073: fill `{gender}` and `{patron_saint}`; set by Admins with `set_group_gender_saint()`. |
| `groups` | `qr_active boolean not null default true` | D5 switch; only `pre_entry`/`terminal` rows can be false (check `groups_regular_qr_active_check`). |
| `groups` | `check_in_code_group_id uuid` | D13: this group checks in with that group's code (same ministry, composite FK, deferrable; no chains). A sharing group has no `qr_codes` row of its own. |
| `groups` | `display_order` (existing) | Now the real list order (pre-entry first, hand-over last), changed with `move_group`. |
| `groups` | — | `unique (ministry_id, cohort_year)` **dropped** (classes share a year; archived rows must not block reuse); plain index instead. Active names stay unique per ministry, checked by the functions. |
| `app_settings` | `level_number_offset smallint` (0–50) | Added to a level before it's shown (first level 9 → 8). |
| `app_settings` | `terminal_name_pattern text` | Default `{cohort_year} - Transitioning`. |
| `app_settings` | `group_name_template` (existing) | Now the default pattern new groups start from (SAY: `{cohort_year} - Yr {level}`). |

New type `group_kind`. New trigger `trg_user_roles_no_hidden_group` refuses any role grant on a non-regular group, whoever writes it.

### L.2 Functions (all per ministry, pinned `search_path`)

- **App Settings (Admins):** `add_group(name, level, cohort_year, qr_color, name_pattern)` (null colour = `pick_group_color`, the palette colour farthest from every colour in use), `delete_group_tier`, `rename_group`, `move_group(id, 'up'|'down')`, `set_group_level`, `set_group_name_pattern`, `set_group_qr_active`, `set_group_check_in_code`. `add_group_tier` stays as a wrapper for the previous app version.
- **Transition (Admins):** `group_transition_core` (internal) does everything; `preview_group_transition(year, pre_entry_name, terminal_names[], mode)` runs it and undoes it, returning a JSON report (or `{error}` / `{blocked, occupants}`); `run_group_transition(…)` runs it for real. `archive_terminal_members()` archives everyone in the hand-over group(s). Mode `one`/`by_gender`/`separate` (D12). Grants on graduating groups move to the new level 1 unless the person still holds a grant on a regular group that stays (Q12: dropped). Audit `GROUP_TRANSITION_RUN` with `details.model = 'group_ladder_0069'`.
- **Access:** `accessible_group_ids()` gives Admins/Church Admin every group, General Coordinators every **regular** group, others their granted regular groups; `has_group_access`/`has_readonly_or_full_group_access` follow the same rule; `export_group_member_names` refuses hidden groups to non-Admins; `reassign_role_group` clears the servant's assignments in the group they leave (Q6).
- **QR page:** `get_qr_codes_with_groups()` adds `kind`, `display_order`, `flow_type`, `shared_with[]`, and leaves out switched-off codes for everyone.
- **Check-in:** `checkin_resolve` refuses a switched-off code ("This check-in code isn't active"); `checkin_served_groups(m, owner)` = the code's group plus every active, switched-on group sharing it; list/mark/fill/undo/duplicate use that set; `checkin_place_member(m, owner, dob)` places a new sign-up (and an "Is this you?" move from another group) by birth year (Q11).
- **Console:** `create_ministry(…, p_terminal_group_name)` also creates the hand-over group; `apply_ministry_settings` accepts the two new settings.

### L.3 Security rules

Hidden = `kind <> 'regular'`. `groups_select`: hidden rows to Admins only. `members_*`, `attendance_*` (member rows) and `outreach_select/insert`: `is_admin()` or the row's group in `accessible_group_ids(…)` (General Coordinators no longer bypass, so they reach regular groups only); `members_update` checks the new group too; `members_delete`: Admin, or GC on a regular group; `qr_codes_write`: hidden groups' codes Admin only.

### L.4 SAY split (0070, one time)

"2004 & older" → "2004 - Yr 5" (same row and code; born 2004–2005), new "2003 - Yr 6" (born 2003, no date, or 2024+), "2002 - Transitioning" (born ≤ 2002); Yr 6 and the hand-over group share Yr 5's code; Kristeen Eshak and Mike Elgabalawi Coordinator + Servant on both; Read-Only on Yr 5 extended to Yr 6. Backups in `<schema>_premm_backup.say_split_0070_*`; undo `0070_down`.

---

Target: Supabase (Postgres 15+). Conventions used throughout: `uuid` primary keys via `gen_random_uuid()` (pgcrypto/pgcrypto-equivalent, available by default on Supabase), `timestamptz` for all timestamps, `text` in place of `varchar` (idiomatic Postgres), soft-delete via status/archived flags rather than hard deletes except where explicitly noted.

---

## 0. Enumerated Types

```sql
create type app_role as enum ('admin', 'general_coordinator', 'sub_coordinator', 'servant');

create type member_status as enum ('active', 'archived');

create type calendar_event_type as enum
  ('Trip', 'Outing', 'Group Discussion', 'Speaker Session', 'Event', 'Holiday');

create type proximity_type as enum ('Local', 'Regional', 'Abroad', 'Unknown');

create type attendee_kind as enum ('member', 'servant');
```

---

## 1. `app_settings`

**v6: one row per ministry**, primary key `ministry_id` (§M.3). The singleton `id` column and its check shown below were dropped in 0066. Later migrations also added `theme_color_light`, `theme_color_dark`, `servants_qr_color`, `my_assigned_header_color`(`_light`), `ladder_position_label`, `actions_needed_lookback_months` (default 12) and, in 0064, `sub_coordinator_auto_servant` (default true). A new ministry's row is created by `create_ministry` in the console. The original single-row design follows.

```sql
create table app_settings (
  id                      boolean primary key default true,  -- singleton pattern
  constraint app_settings_singleton check (id = true),

  app_title_long          text not null default 'Service Members Ministry',
  app_title_short         text not null default 'Members Ministry',
  app_subtitle            text not null default 'Servant Dashboard',
  logo_url                text,                               -- Supabase Storage path

  theme_color             text not null default '#1e3a5f',

  group_label             text not null default 'Group',      -- "Cohort" for this deployment
  member_label            text not null default 'Member',     -- "Youth" for this deployment
  university_label        text not null default 'School',     -- "University/College" for this deployment (0059)
  program_label           text not null default 'Field of Focus', -- "Program of Study" for this deployment (0059)

  proximity_enabled       boolean not null default true,      -- false = everyone is Local, proximity UI hidden (0059)
  show_proximity_on_attendance boolean not null default true, -- Attendance-tab Proximity column, while enabled (0059)

  group_name_template     text default '{cohort_year} Cohort - Yr {position_label}',

  app_version             text not null default '4.0',

  same_day_cutoff_time    time not null default '21:00',
  timezone                text not null default 'America/New_York',
  service_weekday         smallint not null default 5          -- 1=Mon .. 7=Sun (5=Friday)
    check (service_weekday between 1 and 7),

  -- added by later migrations (0026/0027, 0029); blank attendance-window = no cap
  youth_attendance_window_weeks   integer default 52,
  servant_attendance_window_weeks integer default 52,
  birthday_window_days_before     integer not null default 7,
  birthday_window_days_after      integer not null default 14,

  updated_at              timestamptz not null default now()
);

insert into app_settings (id) values (true);
```

---

## 2. `groups`

Each row is a permanent cohort. `ladder_position` is what the Group Transition process advances; `name` is either auto-regenerated from `group_name_template` (when `cohort_year` is set) or manually managed.

```sql
create table groups (
  id                uuid primary key default gen_random_uuid(),
  cohort_year       integer,                       -- nullable: null = not using cohort-year naming
  ladder_position   smallint not null,              -- 0 = pre-entry, 1..(N-1) = progressing, N = terminal
  name              text not null,
  is_terminal       boolean generated always as (ladder_position >= 5) stored,
  is_archived       boolean not null default false, -- true once fully archived out (post-terminal cleanup)
  display_order     integer not null,               -- for stable UI ordering independent of position ties
  created_at        timestamptz not null default now(),

  unique (cohort_year)   -- one row per cohort year, where cohort_year is used
);

create index idx_groups_ladder_position on groups (ladder_position) where not is_archived;
```

**Notes:**
- The pre-entry group (`ladder_position = 0`) is created and managed only by Admins (enforced via RLS, §7).
- A "terminal" group (`ladder_position >= 5`) is never advanced further by the transition function — see §8.
- The UI's aggregate terminal display ("2003 Cohort and earlier - Yr 5+") is **computed at query time**, not stored:
  ```sql
  select min(cohort_year) as oldest_open_cohort
  from groups
  where is_terminal and not is_archived;
  ```

---

## 3. `members`

```sql
create table members (
  id                    uuid primary key default gen_random_uuid(),
  group_id              uuid not null references groups(id),
  photo_path             text,                      -- Supabase Storage object path
  full_name             text not null,
  phone                 text,
  email                 text,
  university_id         uuid references universities(id),
  program_of_study      text,
  date_of_birth         date,
  father_of_confession  text,
  home_address          text,
  is_visitor            boolean not null default false,
  gender                text check (gender in ('Male', 'Female')),
  registration_comments text,                        -- read-only after creation at the app layer
  assigned_servant_id   uuid references profiles(id),
  servant_comments      text,
  is_new_assignment     boolean not null default false,
  status                member_status not null default 'active',
  legacy_source_ref     text,                        -- migration tracking, see DATA MIGRATION note (§11)
  created_at            timestamptz not null default now(),
  updated_at            timestamptz not null default now()
);

create index idx_members_group on members (group_id) where status = 'active';
create index idx_members_assigned_servant on members (assigned_servant_id);
create index idx_members_legacy_ref on members (legacy_source_ref);
create unique index uq_members_legacy_ref on members (legacy_source_ref) where legacy_source_ref is not null;
```

Migration 0087 added the six optional parents' contact columns (§P).

`universities` must be declared before `members` in actual execution order, or the FK added after both tables exist — shown here in logical reading order.

---

## 4. `universities`

```sql
create table universities (
  id          uuid primary key default gen_random_uuid(),
  name        text not null unique,
  proximity   proximity_type not null default 'Unknown'
);
```

---

## 5. `profiles` (extends Supabase `auth.users` — Admins, Coordinators, Servants; never Members)

Supabase Auth owns `auth.users` (id, email, auth metadata) — a single table shared by the whole Supabase project, not per-schema. `profiles` holds the app-specific fields, one row per authenticated user **per schema** and, since v6, **per ministry**: primary key `(ministry_id, id)` (§M.3), created for the address's ministry the first time the person signs in there. Every link to a profile is therefore composite, e.g. `user_roles (ministry_id, user_id) → profiles (ministry_id, id)`. Rows are provisioned lazily by the application (not a database trigger) right after sign-in, using `NEXT_PUBLIC_APP_ENV` to know which schema's `profiles` table to insert into — a trigger on the shared `auth.users` table can't reliably distinguish which environment a given signup came from (this was tried and reverted; see `supabase/migrations/0002_core_tables.sql`).

```sql
create table profiles (
  id                    uuid primary key references auth.users(id) on delete cascade,
  full_name             text not null,
  phone                 text,
  email                 text,                        -- denormalized copy of auth.users.email for convenience
  father_of_confession  text,
  gender                text check (gender in ('Male', 'Female')),
  photo_path            text,
  created_at            timestamptz not null default now()
);
```

**Deactivated (0077, owner-requested 3 Oct 2026):** `deactivated_at timestamptz` / `deactivated_by uuid`. Set by `set_person_deactivated(person, on/off)` (Admins only), which also removes every role the person holds in that ministry and unassigns the youths assigned to them (`assigned_servant_id`/`is_new_assignment` cleared, as `remove_servant` does). While set, a guard on `user_roles` refuses any new role by any path until an Admin reactivates them; only an Admin may change the flag. History (attendance, outreach, assignments, audit) is kept.

---

## 6. `user_roles`

The heart of the permission model. A user can hold multiple rows, including multiple rows of the *same* role type scoped to different groups (this is how cross-group "exception access" is granted — see REQUIREMENTS.md §4.2).

```sql
create table user_roles (
  id          uuid primary key default gen_random_uuid(),
  user_id     uuid not null references profiles(id) on delete cascade,
  role        app_role not null,
  group_id    uuid references groups(id),
  created_at  timestamptz not null default now(),

  constraint role_group_scope_check check (
    (role in ('admin', 'general_coordinator') and group_id is null)
    or
    (role in ('sub_coordinator', 'servant') and group_id is not null)
  ),

  unique (user_id, role, group_id)   -- prevents an identical duplicate grant; different groups are fine
);

create index idx_user_roles_user on user_roles (user_id);
create index idx_user_roles_group on user_roles (group_id);
```

**v6:** grants are per ministry (`ministry_id`, uniqueness `(ministry_id, user_id, role, group_id)`), and `read_only` is a fifth role value. The helpers below keep their names but now check roles **in the current ministry** and let the Church Admin through (§M.5).

**Helper functions** (used throughout RLS policies, §7; original design):

```sql
create or replace function is_admin_or_general_coordinator(uid uuid default auth.uid())
returns boolean language sql stable security definer as $$
  select exists (
    select 1 from user_roles
    where user_id = uid and role in ('admin', 'general_coordinator')
  );
$$;

create or replace function is_admin(uid uuid default auth.uid())
returns boolean language sql stable security definer as $$
  select exists (select 1 from user_roles where user_id = uid and role = 'admin');
$$;

create or replace function has_group_access(gid uuid, uid uuid default auth.uid())
returns boolean language sql stable security definer as $$
  select is_admin_or_general_coordinator(uid)
    or exists (
      select 1 from user_roles
      where user_id = uid and group_id = gid
    );
$$;

create or replace function can_manage_servants(uid uuid default auth.uid())
returns boolean language sql stable security definer as $$
  -- Reassigning a servant's group, or removing a servant: General Coordinator / Admin only
  select is_admin_or_general_coordinator(uid);
$$;
```

---

## 7. Row-Level Security (representative policies)

Enable RLS on every table holding ministry data; deny by default; grant explicitly. **v6:** every policy on a per-ministry table also requires `ministry_id = (select current_ministry_id())`, and group-scoped rules use `accessible_group_ids()` once per query; see §M.6 for the policies as applied. The examples below are the original single-ministry design.

```sql
alter table members enable row level security;

create policy members_select on members for select
  using (has_group_access(group_id));

create policy members_update on members for update
  using (has_group_access(group_id));

create policy members_insert on members for insert
  with check (has_group_access(group_id));

-- Permanent delete: Admins only, any group (correction tool, REQUIREMENTS.md §3.3.1)
create policy members_delete on members for delete
  using (is_admin());
```

```sql
alter table groups enable row level security;

-- Position-0 (pre-entry) groups are visible only to Admins; all other positions
-- follow the normal group-access rule.
create policy groups_select on groups for select
  using (
    (ladder_position = 0 and is_admin())
    or (ladder_position > 0 and has_group_access(id))
  );

create policy groups_admin_write on groups for all
  using (is_admin()) with check (is_admin());
```

```sql
alter table user_roles enable row level security;

create policy user_roles_select on user_roles for select
  using (is_admin_or_general_coordinator() or user_id = auth.uid());

create policy user_roles_admin_write on user_roles for all
  using (is_admin()) with check (is_admin());
```

```sql
alter table attendance_records enable row level security;

create policy attendance_select on attendance_records for select
  using (
    (attendee_type = 'member' and has_group_access(
      (select group_id from members where members.id = member_id)))
    or
    (attendee_type = 'servant' and is_admin_or_general_coordinator())
  );

create policy attendance_write on attendance_records for insert with check (
    (attendee_type = 'member' and has_group_access(
      (select group_id from members where members.id = member_id)))
);
```

*(Every remaining table — `outreach_entries`, `service_calendar_events`, `actions_needed_config`, `audit_log`, `audit_config`, `qr_codes`, `verses`, `app_settings`, `universities` — follows the same pattern: `has_group_access()` for group-scoped tables, `is_admin()` for admin-only tables, and `is_admin_or_general_coordinator()` for the servant-management actions called out in REQUIREMENTS.md §4.1/§6.13. The implementing agent should write the exact policy per table following these three helper functions rather than inventing new patterns — this keeps the whole permission model auditable in one place.)*

**Servant self-reassignment restriction** (REQUIREMENTS.md §6.13 — Sub-Coordinators cannot reassign or remove a servant):

```sql
alter table user_roles enable row level security;  -- already enabled above

-- Only General Coordinators/Admins may write a user_roles row of type 'servant'
-- that changes an existing servant's group scope, or delete a servant's role row.
create policy user_roles_servant_management on user_roles for update
  using (role = 'servant' and can_manage_servants())
  with check (role = 'servant' and can_manage_servants());
```

---

## 8. `attendance_records`

```sql
create table attendance_records (
  id             uuid primary key default gen_random_uuid(),
  attendee_type  attendee_kind not null,
  member_id      uuid references members(id),
  servant_id     uuid references profiles(id),
  service_date   date not null,
  is_visitor_at_time boolean not null default false,  -- snapshot, in case visitor status changes later
  created_at     timestamptz not null default now(),

  constraint attendance_exactly_one_attendee check (
    (attendee_type = 'member' and member_id is not null and servant_id is null)
    or
    (attendee_type = 'servant' and servant_id is not null and member_id is null)
  ),

  unique (member_id, service_date),
  unique (servant_id, service_date)
);

create index idx_attendance_member_date on attendance_records (member_id, service_date);
create index idx_attendance_servant_date on attendance_records (servant_id, service_date);
create index idx_attendance_service_date on attendance_records (service_date);
```

A row's mere existence = present on that date. Absence is inferred (no row for a date the group was tracking). "Tracked dates" for a group = any `service_date` with at least one attendance row for a member of that group.

---

## 9. `outreach_entries`

```sql
create table outreach_entries (
  id                     uuid primary key default gen_random_uuid(),
  member_id              uuid not null references members(id),
  servant_id             uuid not null references profiles(id),
  occurred_at            timestamptz not null default now(),
  type                   text,
  notes                  text,
  follow_up_due          date,
  follow_up_dismissed_at timestamptz,
  created_at             timestamptz not null default now()
);

create index idx_outreach_member on outreach_entries (member_id);
create index idx_outreach_servant on outreach_entries (servant_id);
create index idx_outreach_follow_up on outreach_entries (follow_up_due) where follow_up_dismissed_at is null;
```

RLS: only the creating servant (`servant_id = auth.uid()`) may `update`/`delete` their own rows; anyone with group access to the member may `select`/`insert`.

---

## 10. `service_calendar_events`

```sql
create table service_calendar_events (
  id             uuid primary key default gen_random_uuid(),
  title          text not null,
  description    text,
  event_type     calendar_event_type not null,
  start_date     date not null,
  end_date       date not null,
  all_day        boolean not null default true,
  start_time     time,
  end_time       time,
  location       text,
  attachment_url text,
  created_by     uuid not null references profiles(id),
  created_at     timestamptz not null default now(),

  check (end_date >= start_date)
);

create index idx_calendar_events_dates on service_calendar_events (start_date, end_date);
```

RLS: any authenticated Servant (or higher) may insert/update/delete — matches the confirmed "open to all servants" decision.

---

## 11. `actions_needed_config`

```sql
create table actions_needed_config (
  proximity           proximity_type primary key,
  min_presence_count  integer not null default 0,
  min_absence_weeks   integer not null default 3,
  min_outreach_weeks  integer not null default 4
);

insert into actions_needed_config (proximity, min_presence_count, min_absence_weeks, min_outreach_weeks) values
  ('Local',    0, 3, 4),
  ('Regional', 0, 3, 4),
  ('Abroad',   0, 6, 4),
  ('Unknown',  0, 3, 4);
```

RLS: readable by anyone with app access (feeds the live Dashboard help modal, REQUIREMENTS.md §6.9); writable by Admins only.

---

## 12. `audit_log` and `audit_config`

```sql
create type audit_action_type as enum (
  'APP_ACCESS', 'GROUP_SELECTED', 'MEMBER_EDITED', 'SERVANT_ASSIGNED',
  'OUTREACH_ADDED', 'OUTREACH_UPDATED', 'OUTREACH_DELETED',
  'MEMBER_PHOTO_UPLOADED', 'SERVANT_PROFILES_VIEWED', 'SERVANT_ATTENDANCE_VIEWED',
  'SERVANT_EDITED', 'SERVANT_GROUP_UPDATED', 'SERVANT_PHOTO_UPLOADED', 'SERVANT_DELETED',
  'ADMIN_ACCESS_MAINTENANCE', 'ADMIN_UNIVERSITIES_MAINTENANCE',
  'ATTENDANCE_ADDED', 'ATTENDANCE_REMOVED',
  'CALENDAR_EVENT_CREATED', 'CALENDAR_EVENT_UPDATED', 'CALENDAR_EVENT_DELETED',
  'MEMBER_ARCHIVED', 'MEMBER_DELETED', 'GROUP_TRANSITION_RUN'
);

create table audit_config (
  action_type  audit_action_type primary key,
  enabled      boolean not null default true,
  description  text
);

create table audit_log (
  id           bigint generated always as identity primary key,
  occurred_at  timestamptz not null default now(),
  user_id      uuid references profiles(id),
  action_type  audit_action_type not null,
  group_id     uuid references groups(id),
  details      jsonb
);

create index idx_audit_log_time on audit_log (occurred_at desc);
create index idx_audit_log_user on audit_log (user_id);
create index idx_audit_log_action on audit_log (action_type);
```

RLS: `audit_log`/`audit_config` readable and writable by Admins only. Application code should check `audit_config.enabled` before writing a row of that type (matches current app's per-action toggle behavior).

---

## 13. `qr_codes`

```sql
create type qr_flow_type as enum ('check_in_and_intake', 'intake_only');

create table qr_codes (
  id             uuid primary key default gen_random_uuid(),
  group_id       uuid references groups(id),   -- null = the "Servants" QR
  label          text not null,
  image_path     text not null,                -- Supabase Storage object path
  check_in_token text not null unique,          -- opaque token forming the public check-in URL
  flow_type      qr_flow_type not null default 'check_in_and_intake',
  -- printed_at  timestamptz  -- REMOVED: "Mark printed" dropped in Project A, column dropped in 0066
  updated_at     timestamptz not null default now()
);
```

`flow_type` distinguishes the position-0 (pre-entry) group's QR — which must only ever open the intake/registration form (`intake_only`, no attendance option, since that group isn't tracked for attendance) — from every other group's QR, which supports both the existing-member check-in flow and the new-member intake flow (`check_in_and_intake`). A newly-created group defaults to `check_in_and_intake`; a group at `ladder_position = 0` should be created with `intake_only`.

~~A QR code "needs reprinting" whenever `printed_at is null or printed_at < groups.updated_at`…~~ **Removed (v6):** reprint tracking and the "Needs Reprint" badge are gone. The Group Transition's reprint prompt lists the groups whose labels changed. Since v6 each ministry has exactly one Servants QR (`unique (ministry_id) where group_id is null`), and `check_in_token` stays unique church-wide (§M.3).

*(Add `updated_at timestamptz not null default now()` to `groups`, maintained by a standard `before update` trigger — omitted above for brevity, required in the actual migration.)*

---

## 14. `verses`

```sql
create table verses (
  id          uuid primary key default gen_random_uuid(),
  text        text not null,
  reference   text,             -- e.g. "John 3:16"
  is_active   boolean not null default true
);
```

Application logic: `select * from verses where is_active order by random() limit 1` whenever "Load [Member] Data" is clicked.

---

## 15. The Group Transition function

Sketch of the atomic transition procedure (REQUIREMENTS.md §5). All steps run inside one transaction — a PL/pgSQL function is the natural way to guarantee this in Postgres, since the entire function body is atomic by default (an unhandled exception anywhere inside it rolls back everything it did).

```sql
create or replace function run_group_transition(new_pre_entry_cohort_year integer)
returns void
language plpgsql
security definer
as $$
begin
  -- Guard: admin only (defense in depth; RLS/API layer should also enforce this)
  if not is_admin() then
    raise exception 'Only Admins may run a Group Transition';
  end if;

  -- Advance every non-terminal group one ladder position.
  update groups
  set ladder_position = ladder_position + 1
  where ladder_position < 5 and not is_archived;

  -- Regenerate names for every group that has a cohort_year (template-driven naming).
  update groups
  set name = replace(
        replace(
          (select group_name_template from app_settings),
          '{cohort_year}', cohort_year::text
        ),
        '{position_label}',
        case when ladder_position >= 5 then '5+' else ladder_position::text end
      ),
      updated_at = now()
  where cohort_year is not null and not is_archived;

  -- Create the new pre-entry (position 0) cohort for the upcoming intake year.
  insert into groups (cohort_year, ladder_position, name, display_order)
  values (
    new_pre_entry_cohort_year,
    0,
    replace(
      replace((select group_name_template from app_settings), '{cohort_year}', new_pre_entry_cohort_year::text),
      '{position_label}', '0'
    ),
    (select coalesce(max(display_order), 0) + 1 from groups)
  );

  -- Sub-Coordinators and Servants scoped to a group automatically follow it, since
  -- user_roles.group_id references the same group row whose position just advanced —
  -- no separate update needed here; this is the mechanism, not a side effect to compute.

  insert into audit_log (user_id, action_type, details)
  values (auth.uid(), 'GROUP_TRANSITION_RUN',
          jsonb_build_object('new_pre_entry_cohort_year', new_pre_entry_cohort_year));
end;
$$;
```

If any statement in this function raises an exception, Postgres automatically rolls back every change the function made — satisfying the "no half-baked transition" requirement without any additional application-level rollback logic.

The **optional post-transition servant review** and **QR-reprint prompt** (REQUIREMENTS.md §5) are UI-layer flows that run *after* this function successfully commits — they read the now-updated `groups`/`user_roles`/`qr_codes` tables to build their checklists, but are not part of the atomic transaction itself (they're advisory follow-up steps, not data-integrity-critical ones).

---

## 16. Entity Relationship Summary

```
groups (1) ────────< members (many)
groups (1) ────────< user_roles (many, where role in sub_coordinator/servant)
groups (1) ────────< qr_codes (many, one row typically; null group_id = Servants QR)

profiles (1) ───────< user_roles (many)
profiles (1) ───────< members.assigned_servant_id (many)
profiles (1) ───────< outreach_entries.servant_id (many)
profiles (1) ───────< attendance_records.servant_id (many)
profiles (1) ───────< service_calendar_events.created_by (many)

members (1) ────────< attendance_records (many)
members (1) ────────< outreach_entries (many)

universities (1) ───< members (many)

actions_needed_config, audit_config, audit_log, verses, app_settings — standalone
  (audit_log references profiles/groups but nothing references it)

-- v6 (§M): every table above carries ministry_id, and every link shown is
-- composite on (ministry_id, …), so a row can only point within its own ministry.
ministries (1) ─────< every per-ministry table (ministry_id)
ministries (1) ─────< ministry_addresses (kind 'ministry'; console rows have no ministry)
auth.users (1) ─────< profiles (one per ministry) ; church_admins (church-wide)
app_releases, tenancy_settings — church-wide, standalone
```

---

## 17. `legacy_source_ref` — one-way migration tracking

**v6:** the Sheets tool is retired (REQUIREMENTS.md §10.3). `legacy_source_ref` stays, now unique per ministry, for future per-ministry import tools. The original design follows.

REQUIREMENTS.md §10.1 confirms the current Google Sheets app remains the **sole source of truth** throughout the testing period — the sync is one-way (Sheets → this database). Each refresh makes the *operational* tables an exact mirror of current Sheets content; *configuration* tables are seeded once and then excluded from the ongoing sweep (revised in v5 to broaden this exclusion beyond just role assignments). No separate tracking table is needed — just a `legacy_source_ref` column on every operational table.

**Operational tables — wipe-and-reload on every refresh (revised during Phase I planning, owner's explicit instruction — simpler than the diff-based sync originally specified below).** Add `legacy_source_ref` to each:
```sql
alter table <table_name> add column legacy_source_ref text;
create unique index uq_<table_name>_legacy_ref on <table_name> (legacy_source_ref)
  where legacy_source_ref is not null;
```
Applies to: `members` (already declared directly in its `create table`, §3 above — shown here as the general pattern), `attendance_records`, `outreach_entries`, `service_calendar_events`, and — added during Phase I planning, migration 0034 — `audit_log` (see below; it originally had no `legacy_source_ref` column at all, since it wasn't in scope for migration until this revision). `profiles` is **not** wipe-and-reloaded — servant accounts are pre-provisioned via a separate idempotent step, see MIGRATION_PLAN.md §3.5.

**Refresh algorithm** (run by an external migration tool via the Sheets API, not by the app at runtime), per operational table:
1. Read the current contents of the corresponding sheet/tab.
2. Clear the table (scoped to whichever schema — `qa`/`prod` — the run targets).
3. Insert every current Sheets row fresh, tagged with `legacy_source_ref` for traceability.

(The originally-specified insert/update/delete diff — upsert by `legacy_source_ref`, delete anything whose source row disappeared, delete anything with no `legacy_source_ref` at all — has the same net effect for these tables, but wipe-and-reload is simpler to get right and was the owner's explicit choice during Phase I planning.)

**Configuration tables — excluded from the ongoing sweep (broadened in v5).** `universities`, `verses`, and `audit_config` still get a `legacy_source_ref` column and are populated once from their current Sheets values during the **initial** migration only — never revisited by a subsequent refresh. Each has its own admin maintenance screen in the new app (§6.14, §6.9, §6.1), and edits made there are meant to stick, not get overwritten on the next "refresh the data" request. Trade-off: a brand-new university or verse added on the Sheets side after initial migration won't auto-appear via refresh — it needs to be added directly through the new app's own maintenance screen instead. **`actions_needed_config` is excluded even from the initial seed** (revised during Phase I planning) — the owner configured it directly in the new app; the migration tool never touches this table at all.

`user_roles` is likewise **not** synced this way — it's a new-app-native concept (§4, §6), pre-provisioned once from the old Permissions sheet (MIGRATION_PLAN.md §3.5) and expected to diverge permanently from it afterward, not kept in sync with it.

`groups`, `app_settings`, and `qr_codes` have no Sheets equivalent at all and are outside this refresh process entirely — they're set up once and evolve only through the app's own tools. **`audit_log` was originally in this same "no Sheets equivalent" category but is now migrated and refreshed** (revised during Phase I planning, owner's explicit instruction) — see MIGRATION_PLAN.md §3.10 for the old→new `audit_action_type` mapping.

---

*No tables, functions, or policies in this document have been created in any real database. This is a design specification for review alongside REQUIREMENTS.md.*
