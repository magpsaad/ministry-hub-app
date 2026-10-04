# Database migrations

Plain SQL migrations that build the schema described in `DATABASE_SCHEMA.md`. The same files are applied **twice**, once per environment schema (`qa` first, then `prod`), per `REQUIREMENTS.md` §1.1's single-project, two-schema plan. Since v6 (Project B, migrations 0064–0067) each schema holds **several ministries of one church**, walled off from each other by `ministry_id` (see `REQUIREMENTS.md` §1.2 and `DATABASE_SCHEMA.md` §M).

## Why two schemas instead of two projects

Supabase's free tier caps an account at 2 active projects total. Since the project owner already has one unrelated active project, only one more free project slot exists — so Production and QA live in **one Supabase project**, as **two separate Postgres schemas** (`prod` and `qa`), each holding a full, independent copy of every table. Logins (`auth.users`), storage policies and Auth redirect URLs are project-wide, i.e. shared by both environments. See `REQUIREMENTS.md` §1.1 for the full reasoning and trade-offs.

## How to apply a migration

The SQL files are schema-agnostic on purpose — no table is written as `prod.members` or `qa.members`. Each file is run with its target schema on the `search_path`, so the unqualified `create table members (...)` lands wherever `search_path` points, and every security-definer function then pins that schema as its own `search_path`.

**QA first, always.** A file is run against `prod` only after it has been tested in QA and the owner has given the go-ahead (`REQUIREMENTS.md` §13).

Run each file as **one transaction**, so a failure leaves nothing half-applied:

```sql
begin;
set local search_path to qa;      -- later, with the go-ahead: prod
-- paste the file's contents here
commit;
```

Rules that apply to every new migration:

- **Environment-specific files** say so in their name and first line (`…_qa_…`, `…_prod_…`, `qa_only`, `prod_only`, and 0045). Storage policies are project-wide, so QA and production storage changes are always **separate files** that name their own buckets and never touch the other environment's rules (the lesson of 0012/0045).
- **`_down` files are rollbacks.** They are never run as part of the normal order, only to undo their matching migration.
- **Every ministry-owned table needs `ministry_id`.** Add it as `ministry_id text not null default current_ministry_id() references ministries(id)`. Include it in the table's keys and in composite foreign keys (`(ministry_id, x_id) → x(ministry_id, id)`). Every RLS policy must start with `ministry_id = (select current_ministry_id())`, and every security-definer function must scope each statement to one ministry and get a pinned `search_path` (see 0064 §13 for the pattern).
- **Grant explicitly.** Give new tables and functions the `GRANT`s the app needs in the migration itself (Supabase is tightening default Data API grants for new tables from 30 Oct 2026).
- **Big or risky changes get a dress rehearsal first:** run the whole file plus its checks inside a transaction that ends in a deliberate error, so it rolls back. For before/after comparisons use `begin isolation level repeatable read`. Do slow reads *before* any DDL, and set `set local lock_timeout = '3s'`: rolled-back DDL still locks tables while it runs, which can time out live users' pages.

After any migration, this check should return no rows (a per-ministry table without the ministry condition, or a definer function without a pinned `search_path`):

```sql
select 'policy without ministry condition' problem, tablename || '.' || policyname obj
from pg_policies
where schemaname = 'qa' and tablename not in ('app_releases')
  and coalesce(qual, '') || coalesce(with_check, '') not like '%current_ministry_id()%'
union all
select 'definer function without pinned search_path', p.oid::regprocedure::text
from pg_proc p where p.pronamespace = 'qa'::regnamespace and p.prosecdef and p.proconfig is null;
```

For a brand-new environment, first `create schema if not exists qa;` (or `prod`), apply 0001 onward in order, add the schema under **Project Settings → Data API → Exposed schemas**, and set `NEXT_PUBLIC_APP_ENV=qa` (or `prod`) for the app (see `web/.env.local.example`).

## Files

| Files | Contents |
|---|---|
| `0001`–`0008` | Base schema: types, core tables, roles and helper functions, operational and config tables, check-in functions, RLS policies, grants |
| `0009`–`0059` | Feature phases: storage buckets, servant self-registration, calendar, QR codes, holiday rules, Read-Only role, audit archive, join date and attendance windows, Group Transition, Actions Needed, release history, account merge, school/program labels and proximity switch, plus fixes |
| `0060`–`0063` | **Project A**: settings replacing hard-coded values and clean-ups (0061 QA only, 0062 production only), My Assigned header colours |
| `0064` | **Project B expand**: church-wide tables (`ministries`, `ministry_addresses`, `church_admins`, `tenancy_settings`), `ministry_id` on 17 tables, per-ministry keys and composite FKs, every function and policy rewritten per ministry, console functions |
| `0065_qa_…` / `0065_prod_…` | Per-ministry storage write rules (`storage_write_allowed`), one file per environment |
| `0066` | **Project B contract**: transition fallback off (a request that names no ministry sees nothing), `app_settings.id` and `qr_codes.printed_at` dropped |
| `0067` | RLS performance: `accessible_group_ids()` evaluated once per query instead of per row |
| `0068_qa_only_…` | **QA only.** "Refresh QA from production" for the QA console: `refresh_prod_ministries`, `refresh_qa_only_access`, `refresh_from_prod` (reads `prod.*`, writes only `qa.*`, keeps a backup in `qa_refresh_backup`), plus `refresh_keep_list` and `refresh_log`. Never run with `search_path` prod. |

| `0069` | **Group ladder** (`GROUP_LADDER_PLAN.md` v1.3): group kinds (hidden pre-entry, regular, hidden hand-over), display order, per-group name patterns, QR switches, shared check-in codes, hidden groups enforced in the security rules, the new Group Transition (preview = the run, undone), archive tool, check-in placement by birth year. Creates an empty hand-over group per ministry. Undo: `0069_down` (only before 0070 and before any new-model transition). |
| `0070` | **SAY only, one time**: splits "2004 & older" into "2004 - Yr 5", "2003 - Yr 6" and the hidden "2002 - Transitioning". Stops unless the counts per destination equal the rehearsal's (`v_expect`, per environment; a rehearsal sets `ladder.split_rehearsal = on`). Undo: `0070_down`. |
| `0071` | **Audit Report for General Coordinators**: `get_audit_report_rows()` (when and who only; Admins and General Coordinators) and `get_audit_log_users()` opened to General Coordinators. The audit log itself stays Admin-only. Functions only. Undo: `0071_down`. |
| `0072` | **Pre-approvals that carry class and role**: `pending_servants.intended_grants` (General Coordinator, Coordinator of a class, Servant of a class), applied by `link_approved_pending_servant()` at first sign-in; classes no longer current are skipped; without it, "Servant, Unassigned" as before. Only an Admin (or a database load) can set it. Used to load HSY's servants from their sheet. Undo: `0072_down`. |
| `0073` | **`{gender}` and `{patron_saint}` in name patterns**: `groups.gender_label` / `patron_saint` (set by Admins with `set_group_gender_saint()`), filled in by `render_group_name()`, which the Group Transition now passes for each class (a counted two-call patch of `group_transition_core`). Renames nothing itself. Undo: `0073_down` (restores both functions exactly; rehearsed). |
| `0074` | **Public check-in hardening** (after a congregation member's complaint): no full name list (`checkin_list_*` dropped; `checkin_search_*` return at most 10 short names for 3+ letters); check-in hours (`app_settings.checkin_opens_at/closes_at`, on the service day); the public page can never overwrite or move a record ("Is this you?" re-finds by 2 of name/phone/email, fills blanks only, notes differences for servants). Undo: `0074_down` restores every changed function and its access exactly from `<schema>_premm_backup.fn_backup_0074` (rehearsed). |
| `0075` | **Private photos** (owner-requested, P7): the `<env>-photos` bucket becomes private; its read rule (`storage_photo_read_allowed`) admits only a signed-in person who could see that person in the app (youth photo: access to their class, hidden groups Admin-only; servant photo: anyone with a role in that ministry). The app shows photos through `/api/photo` (an hour-long signed link), which must be live BEFORE this runs. Logos stay public. Undo: `0075_down` (rehearsed). |
| `0076` | **Pre-approvals with class and role removed** (owner-requested, 3 Oct 2026): drops `pending_servants.intended_grants`, its check and guard trigger, and returns `link_approved_pending_servant()` to its pre-0072 form. Everyone signing in is approved first ("Servant, Unassigned") and given a class or role afterwards by an Admin/GC. Undo: `0076_down` (re-applies 0072). |
| `0077` | **Deactivated people** (owner-requested, 3 Oct 2026): `profiles.deactivated_at`/`deactivated_by`; `set_person_deactivated()` (Admins) removes their roles, unassigns their youths and flags them; a `user_roles` guard refuses any role while deactivated; only Admins can change the flag. History kept. Undo: `0077_down`. |
| `0078` | **Approvals match the signed-in email only** (security audit #1): `link_approved_pending_servant()` ignores the email passed in and uses the caller's own confirmed sign-in email. Undo: `0078_down`. |
| `0079` | **Two-step sign-in** (owner-approved, 3 Oct 2026): `aal2_ok()`/`factor_ok()`; Church Admin, Admin and GC powers need the authenticator step (aal2); everything else needs it only for people who turned it on. `gate_info()` for the app's front door; `reset_person_authenticator()` (Admins/Church Admin) for a lost phone. Undo: `0079_down`. |
| `0080a` | Audit types `CHECKIN_REGISTRATION` and `CHECKIN_SIGNUP_ALERT` (run and commit before 0080). |
| `0080` | **Check-in poster protection** (security audit #2, owner-approved 4 Oct 2026): sign-ups stay open any time; field checks on every poster form; speed limits (600 requests per poster per 10 min, 300 searches per poster per 10 min, 25 sign-ups per poster per hour, 50 per ministry per hour); every poster sign-up is an audit entry, and more than 10 in an hour raises a `checkin_alerts` row + audit entry shown to Admins on the Dashboard; **server-only**: once `checkin_guard` holds the fingerprint of `CHECKIN_SERVER_KEY`, check-in functions refuse requests without that key. Undo: `0080_down`. |
| `0081` | The two check-in audit types in each ministry's audit settings, so Audit Logs lists and filters them (always recorded; shown ticked and locked). Undo: `0081_down`. |

**Refresh QA from production (0068) between 0069 in QA and 0069 in production:** it refuses (the new `groups.kind` column has no value in production yet) and changes nothing. It works again once production has 0069.

`project_b/` holds the one-off Project B rollout scripts, all already run in QA and production: `B1_backup.sql` (the in-database backup schema `<env>_premm_backup`), the SAY file move (`B5_copy_say_files.mjs`, `B5_switch_say_paths.sql` and its `_down`, `B5_delete_old_say_files.mjs`), and `delete_test_ministry_qa_only.sql` (removes the QA Test Ministry, TST). The `.mjs` scripts need a service-role key in `web/.env.local`, which should be removed again afterwards.

`tests/project_b/` holds the rehearsal checks: `rehearsal_pre.sql` / `rehearsal_post.sql` (what each type of user can see, before and after, plus every check-in list) and `isolation.sql` (35 cross-ministry isolation tests on a throwaway ministry, run inside a rolled-back transaction). They are safe to re-run after future changes.

`tests/group_ladder/` holds the 0069/0070 checks, run inside a rolled-back rehearsal after the migration: `ladder_tests.sql` (hidden-group security for every role, isolation, QR switches, the TST ladder and transitions incl. per-gender hand-over, Q6/Q12; 57 checks) and `split_tests.sql` (the SAY split, the shared code and placement by birth year; 15 checks).

## The public QR check-in functions

The public check-in/intake pages (`REQUIREMENTS.md` §6.11) have no login, so they can't go through table-level RLS as a signed-in user. The `checkin_*` functions are the sanctioned side door: narrow `security definer` functions granted to `anon`, each of which validates the QR code's token. Since v6 they start from `checkin_resolve(token)`, which finds the QR code's **ministry** (and refuses an inactive one), and every read and write is limited to that ministry. `resolve_ministry_by_address(host)` is the only other function callable without signing in.
