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

`project_b/` holds the one-off Project B rollout scripts, all already run in QA and production: `B1_backup.sql` (the in-database backup schema `<env>_premm_backup`), the SAY file move (`B5_copy_say_files.mjs`, `B5_switch_say_paths.sql` and its `_down`, `B5_delete_old_say_files.mjs`), and `delete_test_ministry_qa_only.sql` (removes the QA Test Ministry, TST). The `.mjs` scripts need a service-role key in `web/.env.local`, which should be removed again afterwards.

`tests/project_b/` holds the rehearsal checks: `rehearsal_pre.sql` / `rehearsal_post.sql` (what each type of user can see, before and after, plus every check-in list) and `isolation.sql` (35 cross-ministry isolation tests on a throwaway ministry, run inside a rolled-back transaction). They are safe to re-run after future changes.

## The public QR check-in functions

The public check-in/intake pages (`REQUIREMENTS.md` §6.11) have no login, so they can't go through table-level RLS as a signed-in user. The `checkin_*` functions are the sanctioned side door: narrow `security definer` functions granted to `anon`, each of which validates the QR code's token. Since v6 they start from `checkin_resolve(token)`, which finds the QR code's **ministry** (and refuses an inactive one), and every read and write is limited to that ministry. `resolve_ministry_by_address(host)` is the only other function callable without signing in.
