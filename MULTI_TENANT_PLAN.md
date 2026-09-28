# Multi-Ministry (Multi-Tenant) Conversion — Analysis & Plan

**Status:** **Version 4.1 (28 Sep 2026): APPROVED by you.** Version 4 was rewritten after your review of v3; 4.1 records your approvals and adds the look-back setting. Nothing in this document has been implemented. No database, storage, code, Vercel or Supabase setting has been changed.
**Scope:** Convert the app so one database (per environment schema) holds several ministries of the same church: University (SAY), High School, Junior High, Grade School/Sunday School, and more.
**Out of scope:** Other churches. They get a separate schema or database, and nothing here prevents that.
**Standing rule (yours):** **every change, however minor, goes to QA first, and is promoted to production only after it has been tested and you give the go-ahead.** That covers code, SQL, storage, Vercel/Supabase settings and clean-ups alike. This plan contains no step that touches production without passing through QA first.

**Legend:** 🔄 **v4** = changed in version 4. 🔄 **v4.1** = changed in version 4.1. ⏳ = still open. ✅ = decided or approved by you.

---

## 🔄 What changed in v4.1

| # | Change |
|---|---|
| G1 | You approved the whole plan, including D5 (move SAY's files into `SAY/`), D7 (separate profile per ministry), D9 (Church Admin console), P3 (remove the Needs Reprint badge) and the Project A scope. All ✅. |
| G2 | **New A12 in Project A:** the Actions Needed look-back period becomes a per-ministry setting (default 12 months). |
| G3 | **New A13 in Project A:** a performance pass so screens load faster (fewer and parallel database calls). **Intake email:** left as is, because Grade School uses a parent's email; you'll confirm with the Sunday School admins. |

## 🔄 What changed in v4

| # | Where | Change |
|---|---|---|
| F1 | Whole plan | **Split into two projects, done in order.** **Project A** removes all ministry-specific hard-coding and does small clean-ups (§10), per your D8. **Project B** is the multi-ministry conversion itself. B doesn't start until A is live in production. |
| F2 | D0, §4 | ✅ `ministry_id` is a **3-letter code you choose** (SAY for University). It's permanent once created, and shown read-only at the top of App Settings. |
| F3 | D2, §2 | ✅ Church Admin = you only. **Correction:** SAY has **2** Admins in production (you and one other). The 3rd I counted was a QA test account ("Tmp Visual Check"), now listed for clean-up. |
| F4 | D3, §3.5, §6 | ✅ Church Admin can see **and fix** every ministry's data. You still work in **one ministry at a time** (through its address), and your actions are recorded in that ministry's audit log. |
| F5 | D4 | ✅ Nothing shared; verses and holiday rules can be *copied* when a ministry is created |
| F6 | D5, §7 | ✅ Buckets stay public for now. Every ministry gets its own folder. ✅ SAY's existing files move into a `SAY/` folder too, so the layout is consistent and there are no special cases. |
| F7 | D6, §15 | ✅ The old Sheets tool is retired (hard stop added). **New §15** sets the rules every future per-ministry import tool must follow. |
| F8 | **D7**, §3.3, §3.6, §4, §5.4 | ✅ **Revised recommendation: one shared login, but a separate profile per ministry.** This answers your hard-wall questions (§3.6). It also **simplifies** the design: the `ministry_servants` table and all "person spans several ministries" logic are gone. |
| F9 | D8, §10 | ✅ Project A: remove every ministry-specific hard-coding first. The full inventory is in §10. |
| F10 | **New §2.5** | You asked for the proposed design for every single-tenant assumption. There are 29 cases, each with its per-ministry design. |
| F11 | §3.8, D9 | ✅ **Church Admin console** as its own small app, at its own address, on the same deployment. It lets you create, view and activate/deactivate ministries (code, name, logo, addresses, settings), manage Version Control and see church admins. |
| F12 | §5.5 | ✅ "Sub-coordinator automatically gets a servant role" becomes a per-ministry setting, **on by default**. |
| F13 | §9 | ✅ Your rulings on P3, P4, P5, P7, P8, P9 and P10 recorded. ✅ P3 also removes the "Needs Reprint" badge, which only existed because of "mark printed". **New P12**: 3 production servants have a Google avatar link stored as their photo, which the app can't display. |
| F14 | §11 | ✅ QA-first rule applied everywhere. The "suspend the rule for this feature" text is removed. **"Soak" is replaced by tester acceptance per ministry.** You were right that real check-ins never reach QA. |
| F15 | §14 | Terminal cohort parked for a later discussion. **Nothing in either project changes terminal-cohort behaviour**, so we don't build around a concept you're about to change. |
| F16 | §13 | New risks: branding cached across addresses, PostgREST joins after the profile key change, the church admin's broad access |

Earlier revision notes (v2, v3) are in Appendix A.

---

## 0. How to read this

| Section | Content |
|---|---|
| 1 | Decisions: yours (✅) and the ones still needing your OK (✅) |
| 2 | What exists today (verified), incl. **2.5: every single-tenant assumption and its new design** |
| 3 | Target design and why it gives a hard wall between ministries |
| 4–7 | Exact change specs: tables, functions, security rules, storage |
| 8 | Application code changes |
| 9 | Problems found that exist today, with your rulings |
| 10 | **Project A**: remove hard-coding + clean-ups (done first) |
| 11 | Execution plan with approval gates (A, then B) |
| 12 | Verification plan |
| 13 | Rollback plan |
| 14 | Risk register |
| 15 | Rules for future per-ministry import tools |
| 16 | Parking lot: decided to do later |

**Terminology.** The UI says **"Service"** or ministry name. The database says **ministry** (`ministries`, `ministry_id`). A ministry is one self-contained program with its own cohorts, members, servants, settings, calendar and photos.

---

## 1. Decisions

| # | Decision | Status and design |
|---|---|---|
| **D0** | Tenant key | ✅ **`ministry_id` = a 3-letter uppercase code** (e.g. `SAY`, and something like `HSM` for High School). You choose it for every ministry (the console asks you for it; §3.8). It must be exactly 3 letters A–Z and unique. It is **permanent**: the display name can change any time, but the code can't, because it's stamped on every row and every storage folder. It is shown **read-only at the top of that ministry's App Settings page**. |
| **D1** | How the app knows the ministry | ✅ **One web address per ministry, same deployment.** QA mirrors production exactly, with a QA address per ministry and no selector. (Appendix A has the history.) |
| **D2** | Church Admin | ✅ **You only** for now. Each ministry has 1–2 ministry Admins. SAY's are you and one other, as today. |
| **D3** | Church Admin's data access | ✅ **Full access to every ministry's data, to diagnose and fix problems.** How it works: <br>• You open a ministry through its address (the console has a link to each), and you see and can change everything there, as its Admin would. <br>• You still see **one ministry at a time**. No screen mixes two ministries' data. <br>• Everything you do is written to **that ministry's** audit log, visible to its Admins. <br>• Implication to be aware of: this includes children's records in Grade School and Junior High. |
| **D4** | Shared vs per-ministry data | ✅ **Nothing is shared.** Verses and holiday rules can be **copied** into a new ministry when it's created, and the copies are then independent. The only church-wide items are the login itself (unavoidable; §3.6), the list of ministries (visible only in the console), and the app version (Version Control, P9). |
| **D5** | Photo privacy | ✅ Buckets **stay public for now**. **Every ministry gets its own folder** (§7). ✅ SAY's existing 241 files move into `SAY/` too, so the layout is consistent. Reminder owed to you: P7, private buckets, to be discussed before any children's ministry launches. |
| **D6** | Old Sheets migration tool | ✅ **Retired** for SAY. It gets a hard stop so it can't run, and is kept only as a reference. **Each new ministry will need its own one-time import tool before launch.** §15 sets the rules those tools must follow (never delete, only insert into their own ministry, QA dry run first). |
| **D7** | Person serving in two ministries | ✅ **Revised recommendation: one shared login, separate profile per ministry.** See §3.6 for the direct answers to your questions. In short: <br>• Signing in on one ministry's address does **not** sign you in to another. <br>• Each address shows only its own ministry. <br>• The person's name, phone, photo, gender, Father of Confession and join date are **separate copies per ministry**. <br>So even a person's own details can't cross the wall. The cost is that someone serving in two ministries fills in their details once per ministry. |
| **D8** | Hard-coding | ✅ **Removed first**, as Project A (§10), before Project B starts |
| **D9** 🔄 v4 | Where the Church Admin tools live | ✅ **A separate small "Church Admin console"** at its own address (production and QA), served by the same deployment and database. It is the **only** place where the list of ministries exists. Details in §3.8. |

🔄 **v4.1:** ✅ **All decisions approved (28 Sep).** You approved D5's file move, D7, D9, P3's badge removal and the Project A scope. The only open item is the intake-email question (§10.1), to be decided before Grade School's import.

---

## 2. Current state (verified)

Sources: read-only queries of the live database catalog and row counts (QA, plus admin lists and photo-path counts in prod), a full inventory of `web/src`, the `migration/` tool and the docs. Nothing was written anywhere.

### 2.1 Environments

- One Supabase project (`youth-ministry-app`, us-west-2, Postgres 17) with schemas `qa` and `prod`. **They are structurally identical.** I compared every column, constraint, index, trigger, policy and function with the schema name normalized. The only differences:
  - `prod` has an orphaned `handle_new_user()` function (to be dropped, P10).
  - `qa` has four `zz_snapshot_*` backup tables (to be dropped, P10).
- Vercel has two projects, `youth-ministry-app-prod` and `youth-ministry-app-qa`, plus your unrelated VMSA project.
- Storage buckets per environment: `qa-photos`, `qa-calendar`, `qa-branding` and the `prod-*` equivalents. All are public.
- Logins (`auth.users`, 80 accounts) are shared project-wide. Profiles are created by the app on first sign-in.

### 2.2 QA data volume

| Table | Rows | Table | Rows |
|---|---|---|---|
| members | 919 | audit_log | 4,064 |
| attendance_records | 4,616 (3,794 member / 822 servant) | outreach_entries | 504 |
| profiles | 72 | user_roles | 85 |
| groups | 7 (6 active) | qr_codes | 7 (1 Servants QR) |
| universities / verses | 47 / 25 | service_calendar_events | 99 |
| audit_config / actions_needed_config | 24 / 4 | app_settings | 1 |
| pending_servants | 2 | app_releases | 4 |
| storage objects | 240 photos, 1 logo | holiday_rules / pending_servant_attendance | 0 / 0 |

**Admins and General Coordinators (🔄 v4 corrected):**
- **Production:** 2 Admins (you and one other) and 3 General Coordinators.
- **QA:** the same 5 people, plus a leftover test account "Tmp Visual Check" (`tmp-visual-check@example.com`, created 12 Sep) holding Admin. It is scheduled for removal in Project A.

### 2.3 How access works today

- Row-level security is on for all 18 app tables, with 40 policies. They all rely on 7 helper functions that look up `user_roles` **with no notion of ministry** (`is_admin()` means "admin anywhere").
- There are 46 database functions: 16 public no-login check-in functions, 13 Admin/Coordinator actions, 5 person-level functions, 4 triggers, plus helpers.
- The app never queries the database from the browser. All calls go through three client files, which makes it a good single place to attach the ministry.
- About 40 queries have no explicit filter and return "whatever the security rules allow". After Project B they are scoped to the current ministry automatically (§3.2).

### 2.4 Hard-coded ministry-specific values

Moved to Project A: the full inventory is in §10.

### 2.5 🔄 v4 Every single-tenant assumption and its new design

You asked for the proposed design in every case. The rule applied to all of them: **an action invoked in a ministry reads and changes only that ministry's rows.** The database enforces it (§3.1), not just the screens.

| # | Assumption today | Effect if left as is | New design |
|---|---|---|---|
| 1 | `app_settings` is one row for everything | All ministries would share one title, logo, weekday, timezone | **One settings row per ministry**, keyed by `ministry_id`. It is created by the console when the ministry is created. The ministry code is shown read-only at the top of the page. |
| 2 | Cohort year is unique across the table | Two ministries couldn't both have a "2010" cohort | Unique **within a ministry** |
| 3 | School/university name unique | Two ministries couldn't both list the same school | Unique within a ministry; each keeps its own list |
| 4 | Role grants unique per person/role/group, "Unassigned" unique per person | A person couldn't be Unassigned in two ministries | Unique within a ministry |
| 5 | A servant has one attendance record per date | A servant couldn't attend two ministries on the same day | One per servant **per ministry** per date |
| 6 | Audit on/off switches and Actions-Needed thresholds are one global set | One ministry's settings would change another's | One set **per ministry**, seeded when it's created |
| 7 | Group Transition, Add/Remove Tier, Rename work on "the" ladder | **A transition would advance every ministry's cohorts at once** | Each works on **the current ministry's ladder only**, using that ministry's naming template |
| 8 | One Servants QR code; its list shows every profile | A servant scanning would see every ministry's servants | **One Servants QR per ministry**, listing only that ministry's servants and pending servants |
| 9 | "Archive audit log older than…" deletes from the whole table | **One Admin would erase every ministry's audit history** | Deletes only the current ministry's entries |
| 10 | Remove Servant / Revoke / Reassign / Grant act on the person | **Removing a servant would remove them from every ministry** | Act only on that ministry's role grants and members |
| 11 | "Is today a service day?" and "today's date" read *any* settings row | Check-in would use a random ministry's weekday and timezone | Read the **ministry of the scanned QR code** |
| 12 | Check-in's "possible duplicate member" search covers all members | An anonymous visitor at High School could learn a same-named SAY member exists | Search **only the QR code's ministry** |
| 13 | "Resolve duplicate" can move any member into the scanned group | A member could be moved across ministries | Only members of the QR code's ministry; the database also refuses cross-ministry moves (§3.1 L1) |
| 14 | "Last service date" = latest attendance anywhere | Dashboards would count against another ministry's date | Latest date **in the current ministry** |
| 15 | Profiles are global (one per login) | A person's details would be shared across ministries | ✅ **One profile per person per ministry** (D7) |
| 16 | Merge two accounts / Remove person act across the whole database | Could rewrite another ministry's history | Act **only within the current ministry** (possible because of #15) |
| 17 | Pending registration and approval linking assume one ministry | Serving in SAY would silently close a High School request | Pending requests and approvals are **per ministry** |
| 18 | Storage paths are flat, one bucket per environment | All ministries' photos mixed together | **Folder per ministry**: `SAY/…`, `HSM/…` (§7) |
| 19 | Legacy import references unique across table | Future imports for two ministries could collide | Unique within a ministry |
| 20 | "List of audit users" and "QR codes list" functions return everything | Would list every ministry's people and QR codes | Current ministry only, **and** they now require a signed-in, approved user (P2, P4) |
| 21 | Sub-coordinator automatically gets a servant role | Forced on every ministry | **Per-ministry setting, on by default** (§5.5) |
| 22 | Version Control is edited by any Admin | Each ministry's Admin could change the app version for all | **Church Admin only, in the console**. It's the one intentionally church-wide value, shown in every ministry (P9). |
| 23 | Check-in "remember me" cookies named `say_…` | SAY-specific name | Neutral name (Project A). Each ministry's address keeps its own cookies automatically. |
| 24 | The sign-in gate counts roles "anywhere" | A SAY servant would get into High School's pages | Counts roles **in this address's ministry**; if none, go to **this ministry's** registration page |
| 25 | Access Maintenance lists every profile and assumes one servant grant per person | Would show other ministries' people | Lists the current ministry's people only; "Add existing account by email" covers people with a login but no profile here yet (§3.7) |
| 26 | Servant directory, export lists, audit screens, calendar, verses, etc. read "everything" | Would show all ministries | Scoped automatically by the database to the current ministry (§3.2); **no code change** needed, and verified user by user (§12, V3) |
| 27 | QR check-in token is unique across the table | – | **Stays church-wide unique on purpose.** It's a random code, and the anonymous check-in page uses it to find the ministry. It reveals nothing. |
| 28 | Branding (login page, icon, title) comes from "the" settings | One ministry's logo everywhere | Comes from the **address's ministry**. These pages are never cached across addresses (§14, R16). |
| 29 | REQUIREMENTS.md says "single-tenant per ministry" | Out-of-date documentation | Updated in Project B (P11) |

---

## 3. Target design

### 3.1 Principle: one rule, enforced in four independent layers

> **Every ministry-owned row carries a `ministry_id`. A person can only read or write rows of the ministry whose address they are using, and only if they hold a role in it (or are the Church Admin).**

| Layer | Mechanism | What it catches |
|---|---|---|
| **L1: data integrity** | **Composite foreign keys**, e.g. `members(ministry_id, group_id) → groups(ministry_id, id)` | Makes it *physically impossible* to store a row that points at another ministry's row, whoever writes it: app bug, function bug, hand-written SQL, or an import tool |
| **L2: security rules** | Every rule on every ministry table requires `ministry_id = current ministry` **and** a role in that ministry | A forgotten filter in app code can never show another ministry's rows |
| **L3: database functions** | Each function takes the ministry from what it acts on (QR code, group, role grant) and scopes every statement to it | These functions bypass L2 by design, so each is rewritten and tested individually (§5) |
| **L4: application** | The ministry is decided in one place (from the address) and sent on every database call | Correct screens and counts |

### 3.2 How the ministry reaches the database

- **The address decides.** The one function `getActiveMinistry()` looks up the address (e.g. `highschool-ministry.vercel.app`) in `ministry_addresses` and gets the code (e.g. `HSM`). QA and production work identically.
- **Every database call carries the code** in a request header (`x-ministry-id`), attached in the three client files. The database reads it with `current_ministry_id()`.
- **The header only narrows; it never grants.** Every rule still requires a real role in that ministry. Someone who fakes the header to another ministry's code sees nothing unless they genuinely serve there, and then they're entitled anyway.
- **Unknown address:** a plain "This address isn't set up" page, with no data calls. **Inactive ministry:** "This ministry isn't active", with no sign-in or check-in, except for you (Church Admin).
- **Anonymous check-in pages** use the ministry of the scanned QR code, not the header.
- **Transition fallback:** while the old code is still running (between the database change and the code deploy), a request with no header is treated as SAY. This is what lets the database change go in first with no visible effect. Once the new code is verified, the fallback is switched off, and a missing header then means no data (fail closed).
- **Inserts need no code change:** every `ministry_id` column defaults to the current ministry, and L1 rejects any mismatch. Database functions always set it explicitly.

### 3.3 New tables

| Table | Purpose | Key columns |
|---|---|---|
| `ministries` | One row per ministry | `id text` PK = the **3-letter code** (check: exactly `[A-Z]{3}`; a trigger blocks changing it), `name`, `is_active`, `display_order`, `created_at` |
| `ministry_addresses` | Which web address belongs to which ministry, or to the console | `host` PK, `ministry_id` (NULL for the console address), `kind` (`ministry` / `console`). The `qa` schema holds QA addresses and `prod` holds production ones, so the two can never mix. |
| `church_admins` | Who is Church Admin | `user_id` PK (a login) |
| `tenancy_settings` | One row: the transition fallback (`default_ministry_id`, NULL = fail closed) | – |

🔄 **v4:** The v1–v3 `ministry_servants` table is **gone**, because profiles are now per ministry (D7) and do its job directly.

### 3.4 What is per-ministry vs church-wide

| Scope | Tables |
|---|---|
| **Per ministry** (`ministry_id NOT NULL`, 17 tables) | `app_settings`, `groups`, `members`, `universities`, `attendance_records`, `outreach_entries`, `service_calendar_events`, `holiday_rules`, `verses`, `qr_codes`, `pending_servants`, `pending_servant_attendance`, `audit_log`, `audit_config`, `actions_needed_config`, `user_roles`, 🔄 **`profiles`** |
| **Church-wide** | `app_releases` (Version Control), `ministries`, `ministry_addresses`, `church_admins`, `tenancy_settings`. All but `app_releases` are readable only through the console or narrow functions. |
| **Outside our tables** | `auth.users`, i.e. the logins, owned by Supabase and shared project-wide (§3.6) |

### 3.5 Roles

- Every role grant belongs to a ministry. Admin and General Coordinator are **per ministry**, as is "Unassigned servant".
- All existing role behaviour (read-only exception access, union of roles, sub-coordinator auto-servant) is unchanged, just scoped to the ministry. Auto-servant becomes a setting (§5.5).
- **Church Admin (D3):** the helper functions treat the Church Admin as an Admin **of whichever ministry's address they are on**. So you get full access there, but still one ministry at a time. Your actions go into that ministry's audit log. You don't need a role grant in each ministry. You do get a profile there the first time you sign in on its address, as everyone does.

### 3.6 ✅ Logins, profiles and the hard wall (D7, answering your questions)

**Why the login is shared.** Supabase has one login system per project, and QA and production already share it. We can't give each ministry its own login system without a separate Supabase project per ministry, which would cost at least $10/month each. So the login (the Google identity, or the email and password) is the one thing shared.

**Your questions:**

| Your question | Answer |
|---|---|
| Will it be clear which ministry they're logging into? | **Yes.** The address is the ministry's own. The login page shows that ministry's name and logo, and every page afterwards shows that ministry's name and logo in the header. Nothing on the page ever names another ministry. |
| Does logging into one log them into the others? | **No.** Each address keeps its own sign-in. Signing in on SAY's address does nothing on High School's address. Signing out of one doesn't sign out of the other. With Google sign-in, the second sign-in is just one tap, because Google remembers the account. It is still a separate, deliberate sign-in on that address. |
| Could data ever get confused for that user? | **No.** Every request from an address carries only that address's ministry code. The database refuses rows from any other ministry (§3.1), and there is no switcher. If the person has both ministries open in two browser tabs, they are two independent apps side by side, and no page ever combines them. |
| Can they switch or see both at once? | **No.** There is no switcher and no combined view. To work in the other ministry they open its address and sign in there. |

**Why I now recommend separate profiles per ministry.** In v1–v3 the profile (name, phone, photo, gender, Father of Confession) was shared. That meant a High School coordinator editing Mark's phone number would change what SAY sees. It's small, but it is data crossing the wall, which you've said must not happen. With a profile per ministry:
- Mark's details in High School are a **separate copy** from his details in SAY, edited separately.
- His **join date, attendance, photo and history are per ministry** naturally.
- **Merging duplicate accounts and "remove person" only ever touch one ministry.** This removes the most complex cross-ministry functions from the plan.
- **Cost:** a person serving in two ministries fills in their phone, gender, etc. once per ministry. The registration page already asks for them, so it's no extra screen. A password change applies to both, because it's the same login.

**How a person enters a ministry:**
1. They sign in on that ministry's address. A profile is created **for that ministry**, as happens today for SAY.
2. They have no role there, so they land on that ministry's registration page and submit it.
3. That ministry's Admin approves the request, and on their next sign-in they are an Unassigned servant there.

### 3.7 Registration, approval, adding people

- `/register` has **no ministry picker**. The address decides the ministry, and one pending request is kept per person per ministry.
- Approval happens in that ministry's Pending Servants screen and grants a role **in that ministry only**.
- **Add existing account by email** (kept, per your decision). A ministry Admin types an email. If a login exists, the person gets a profile in this ministry with no role, and then appears in the list to be granted a role. The screen only says "added" or "no account with that email", and never reveals other ministries.
- The public Servants QR is per ministry and lists only that ministry's servants and pending servants.

### 3.8 ✅ Church Admin console (D9)

A small separate app for you, served by **the same code and deployment** at its own address (e.g. `ministry-admin.vercel.app`, plus a QA equivalent). Only Church Admins can sign in; anyone else sees "Not authorized". It is the **only place the list of ministries exists**.

| Screen | What you can do |
|---|---|
| **Ministries** | See every ministry: code, name, active/inactive, production and QA addresses, number of Admins, created date. Open any ministry's app in a new tab (full access, D3). **Turn a ministry active or inactive.** Inactive means its address shows "This ministry isn't active", and nobody but you can sign in or check in. Data is kept. There is **no delete**. |
| **Create ministry** | Enter the **3-letter code** (checked for format and uniqueness; permanent), name, logo, production and QA addresses, first Admin(s) by email (1–2), and the initial settings: labels, service weekday, timezone, cutoff time, proximity on/off, sub-coordinator auto-servant on/off, theme colour. Optionally copy verses and holiday rules from an existing ministry. Everything is created in one step: settings row, audit switches, Actions-Needed thresholds, the pre-entry group and its intake-only QR, the Servants QR, the address records and the first Admins' profiles and roles. |
| **Edit ministry** | Change name, logo, addresses and settings. The code is shown but can't be edited. |
| **Version Control** | Add and edit release notes (P9). They are shown in every ministry's app. |
| **Church Admins** | View who holds Church Admin (v1: view only; changes by SQL, since it's just you) |

**Your manual steps per new ministry** (about 10 minutes; the console shows the checklist after you create it):
1. **Vercel:** add the ministry's production address to the production project and its QA address to the QA project (*Settings → Domains*). `.vercel.app` names are free if available.
2. **Supabase:** in *Authentication → URL Configuration*, add both addresses to the Redirect URLs, each listed exactly. Never use a broad pattern like `*.vercel.app`.
3. Following your QA-first rule, create the ministry in the **QA console** first and test it; then create it in the production console.

If step 1 or 2 is missed, sign-in on that address fails with an error. Nothing leaks.

---

## 4. Table-by-table change specification

For every per-ministry table, in this order:
1. Add `ministry_id text` (nullable).
2. Backfill it with `'SAY'`.
3. Set `DEFAULT current_ministry_id()` and `NOT NULL`.
4. Add a FK to `ministries(id)` (`ON DELETE RESTRICT`, `ON UPDATE RESTRICT`).
5. Add `unique (ministry_id, id)` where referenced.
6. Add the composite FKs.

| Table | Key / uniqueness changes | Composite FKs added |
|---|---|---|
| 🔄 `profiles` | PK `id` → **PK `(ministry_id, id)`**. `id` stays the login id, and the FK to `auth.users` (cascade) is kept. | – |
| `app_settings` | PK → `ministry_id`. Drop the singleton check. Add `sub_coordinator_auto_servant boolean not null default true` (§5.5). Old `id` column kept until the contract step, then dropped. | – |
| `groups` | `unique(cohort_year)` → `unique(ministry_id, cohort_year)` | – |
| `members` | legacy-ref unique → per ministry | `(ministry_id, group_id)→groups`; `(ministry_id, university_id)→universities`; `(ministry_id, assigned_servant_id)→profiles` |
| `universities` | `unique(name)` → `unique(ministry_id, name)` | – |
| `attendance_records` | `unique(servant_id, service_date)` → `unique(ministry_id, servant_id, service_date)` | `(ministry_id, member_id)→members`; `(ministry_id, servant_id)→profiles` |
| `outreach_entries` | – | `(ministry_id, member_id)→members`; `(ministry_id, servant_id)→profiles` |
| `service_calendar_events`, `holiday_rules` | – | `(ministry_id, created_by)→profiles` |
| `verses` | legacy-ref unique → per ministry | – |
| `qr_codes` | `check_in_token` stays globally unique (§2.5 #27). One Servants QR per ministry: `unique(ministry_id) where group_id is null`. `printed_at` dropped at the contract step (P3). | `(ministry_id, group_id)→groups` |
| `pending_servants` | One open self-registration per person per ministry (checked against QA data first) | `(ministry_id, approved_by / resulting_profile_id / submitted_by_profile_id)→profiles` |
| `pending_servant_attendance` | – | `(ministry_id, pending_servant_id)→pending_servants` (cascade, as today) |
| `audit_log` | legacy-ref unique → per ministry | `(ministry_id, group_id)→groups`; `(ministry_id, user_id)→profiles` |
| `audit_config` | PK → `(ministry_id, action_type)` | – |
| `actions_needed_config` | PK → `(ministry_id, proximity)` | – |
| `user_roles` | Uniques → per ministry | `(ministry_id, group_id)→groups`; `(ministry_id, user_id)→profiles` |
| `app_releases` | unchanged (church-wide) | – |

**Existing single-column links to `profiles(id)`** (10 of them) are replaced by the composite ones above, because `profiles.id` alone is no longer unique. **Every screen that joins to profiles** (servant names on members, outreach, the audit log, etc.) is exercised in V3 (§12) to prove the joins still resolve.

---

## 5. Function-by-function specification (all 46 + new)

Rules for **every** function:
- `SECURITY DEFINER` functions get a pinned `search_path` and fully schema-qualified bodies (the 0043 pattern, so one file works for `qa` and `prod`).
- Each takes the ministry from its input and scopes **every** statement to it.
- Only the check-in functions remain callable without signing in.
- Functions whose arguments or results change are dropped and recreated (never overloaded).

### 5.1 Helpers

| Function | Change |
|---|---|
| **new** `current_ministry_id()` | The `x-ministry-id` header if it is exactly 3 letters A–Z, else the transition fallback (NULL afterwards). Never errors. |
| **new** `resolve_ministry_by_address(host)` | Callable without sign-in. Returns the code, name and active flag for **that one address**, or nothing. It has no "list all" form. |
| **new** `is_church_admin()`, `is_admin_in(m)`, `is_admin_or_gc_in(m)`, `is_coordinator_in(m)`, `has_ministry_role(m)`, `group_ministry_id(g)` | Explicit-ministry versions for functions acting on a specific row. **Church Admin counts as Admin in every ministry (D3).** |
| `is_app_user`, `is_admin`, `is_admin_or_general_coordinator`, `is_coordinator`, `can_manage_servants`, `has_group_access`, `has_readonly_or_full_group_access` | Same names and signatures, now meaning "in the current ministry". Church Admin passes them all. |

### 5.2 Public check-in (16 functions, no sign-in)

Every one starts from the scanned QR code (`qr_codes where check_in_token = p_token`), which gives the ministry. Then **every** read and write is limited to that ministry, and every insert sets it explicitly.

| Function | Specific change |
|---|---|
| `checkin_get_flow` | Also returns the ministry, so the page shows that ministry's branding, school list and date rules |
| `checkin_list_members`, `checkin_mark_attendance`, `checkin_fill_missing_member_fields`, `checkin_undo_attendance`, `checkin_submit_new_member` | Ministry-scoped. A school from another ministry is rejected. |
| `checkin_find_possible_duplicate_member` | Searches **only the QR code's ministry** (§2.5 #12) |
| `checkin_resolve_duplicate_member` | Only members of the QR code's ministry (§2.5 #13) |
| `checkin_list_servants` | Only that ministry's profiles and pending servants (§2.5 #8) |
| `checkin_mark/undo_servant_attendance`, `checkin_mark/undo_pending_servant_attendance`, `checkin_submit_new_servant` | Servant or pending servant must belong to that ministry; rows carry its code |
| `is_service_day()`, `checkin_today()` | Use **that ministry's** weekday and timezone (§2.5 #11) |

### 5.3 Admin and Coordinator actions (13)

| Function | Change |
|---|---|
| `run_group_transition`, `add_group_tier`, `delete_group_tier`, `rename_group` | Current ministry's ladder only (§2.5 #7). **Terminal-cohort behaviour is not changed** (parked, §16). |
| `archive_audit_log` | Current ministry only (§2.5 #9) |
| `grant_servant_role`, `reassign_role_group`, `revoke_role_grant`, `remove_servant` | Current ministry only; target group must be in the same ministry (§2.5 #10) |
| `export_group_member_names` | Group must be in the current ministry. Still any coordinator of the ministry (✅ P5). |
| `get_audit_log_users` | Current ministry, **Admins only** (P2) |
| `get_qr_codes_with_groups` | Current ministry, **approved users only** (✅ P4) |
| `mark_qr_code_printed` | ✅ **Removed** (P3), in Project A |

### 5.4 🔄 Person-level functions (much simpler because profiles are per ministry)

| Function | Change |
|---|---|
| `merge_servant_accounts` | Merges two profiles **within the current ministry only** (Admin of that ministry, or Church Admin). The other ministries are untouched. |
| `remove_profile_completely` | Removes the person's profile **in the current ministry only**. The "has real history" safety check stays. |
| `link_approved_pending_servant` | Links the approved request **for this address's ministry** |
| `absorb_own_pending_registration` | Only absorbs a pending request of **this** ministry (fixes the v1-noted risk that serving in SAY closes a High School request) |
| `submit_own_servant_registration` | Files the request in this address's ministry |

### 5.5 Triggers and new functions

| Function | Change |
|---|---|
| `ensure_servant_for_sub_coordinator` | ✅ Adds a servant role **only if the ministry's `sub_coordinator_auto_servant` setting is on** (default on, SAY stays on). It is editable on App Settings (and in the console). |
| `update_join_date_on_attendance` | Updates that ministry's profile's join date |
| `add_member_photo`, `set_updated_at`, `clear_new_assignment_on_outreach` | Ministry-scoped / unchanged |
| **new** `create_ministry(...)`, `update_ministry(...)`, `set_ministry_active(...)` | Console only; Church Admin only (§3.8) |
| **new** `add_person_to_ministry_by_email(email)` | Admin of the current ministry (§3.7) |

---

## 6. Security rule (RLS) specification

Every rule on a per-ministry table becomes:

```
USING      ( ministry_id = (select current_ministry_id()) AND <today's rule> )
WITH CHECK ( ministry_id = (select current_ministry_id()) AND <today's rule> )
```

"Today's rule" keeps its wording; its helpers are now ministry-scoped and let the Church Admin through (§5.1).

| Table | Notes |
|---|---|
| All 17 per-ministry tables | Pattern above. Settings and the school list stay readable without sign-in, **for the address's ministry only** (login page and check-in need them). |
| `profiles` | Read: yourself, or app users of the same ministry. Update: yourself, or a coordinator of that ministry. Insert: yourself, in this ministry. |
| `ministries`, `ministry_addresses`, `church_admins`, `tenancy_settings` | **No direct access.** Reachable only through the console's functions and `resolve_ministry_by_address()`. |
| `app_releases` | Read: everyone. Write: Church Admin. |

A catalog check (§12, V1) proves every per-ministry table has security on and every rule includes the ministry condition. The migration aborts otherwise.

---

## 7. Storage specification

- 🔄 **Every ministry has its own folder** in each bucket:
  - `SAY/members/…`, `SAY/profiles/…`, `SAY/calendar/…`, `SAY/branding/…`
  - `HSM/members/…`, and so on for each ministry
  - Servant photos go under the ministry too, because profiles are per ministry.
- **Write rules:** you may upload to, replace in or delete from a folder only if you are an approved user of **that folder's** ministry (branding: its Admin), or the Church Admin. The rules look at the folder name, not the request header.
- **Read:** unchanged. Buckets stay public (✅ D5, reminder P7).
- ✅ **Moving SAY's existing files into `SAY/`** (240 photos and 1 logo in QA; the same in production later):
  1. Copy each file to its new folder path.
  2. Update the stored paths (members, profiles, logo) in one transaction.
  3. Verify every photo loads.
  4. **Only after you've checked**, delete the old copies.

  QA first, as always. Nothing is lost at any point, because the old files remain until you approve their removal. This removes the "legacy flat files" special case from the security rules.
- **Lesson from migrations 0012/0045:** storage rules are project-wide, so the QA and production storage changes are **separate files**, and neither ever touches the other environment's rules.

---

## 8. Application code changes (Project B)

| File / area | Change |
|---|---|
| **new** `lib/ministry-context.ts` | `getActiveMinistry()`: the one place the ministry is decided (from the address). It is cached per request and fails closed. |
| `lib/supabase/server.ts`, `proxy.ts`, `client.ts` | Attach `x-ministry-id` to every database call |
| `lib/supabase/proxy.ts` (gate) | Resolve the address first (unknown → "not set up"; inactive → "not active" except Church Admin; console address → console). Then count roles **in this ministry** (Church Admin passes); if none, go to this ministry's `/register`. |
| `lib/roles.ts` | Add `isChurchAdmin`, which makes `isAdmin` true on every ministry address |
| `lib/supabase/ensure-profile.ts` | Creates the profile **for this ministry** on first sign-in at its address (the header default does it) |
| `app/register/*` | No picker; the request goes to this ministry |
| `app/admin/access-maintenance/*` | "Add existing account by email" |
| **new** `app/console/*` | Church Admin console (§3.8), incl. Version Control moved from `app/version-control/*` |
| App Settings page (`app/admin/actions-needed-config/*`) | Ministry code shown read-only at the top. New "Sub-coordinators automatically become servants" toggle. Save by `ministry_id` instead of the singleton `id`. |
| `app/login/page.tsx`, `app/layout.tsx`, `app/manifest.ts` | Branding, title, colour and **home-screen icon** from the address's ministry. These routes are dynamic per request (never cached across addresses, R16). |
| `app/checkin/*`, `lib/checkin.ts` | Ministry from the QR code; that ministry's branding and school list |
| `lib/qrcodes.ts` | QR codes carry the ministry's **own** address |
| `lib/storage.ts` + the 4 upload actions | Folder-prefixed paths (§7) |
| **No change needed** | About 40 "read everything" queries (§2.5 #26), the header component, browser-storage keys (separate per address automatically) |

Size estimate for Project B: about 5 migration files (expand, QA storage, contract, file move, and a separate prod storage file later), plus verification and rollback scripts, and roughly 30 app files, the console being the largest new piece.

---

## 9. Problems found that exist today

| # | Issue | Your ruling / plan |
|---|---|---|
| **P1** | The old Sheets tool wipes whole tables and the photo bucket | ✅ Retired (D6). Hard stop added in Project A. It's a local file change only. |
| **P2** | `get_audit_log_users()` can be called without signing in and returns every audit user's name | Fixed in Project A (Admins only), **QA first, then production after testing** |
| **P3** | "Mark QR printed" has no permission check | ✅ **Remove the function** (Project A). QR codes stay printable by anyone who can see them. ✅ The **"Needs Reprint" badge** on the QR Codes page only exists because of "mark printed", so it goes too. The Group Transition's separate "reprint QR codes for…" prompt, which is based on label changes, **stays**. |
| **P4** | QR codes list available to any signed-in user | ✅ **Only approved users of that ministry.** Today there's one ministry, so the Project A fix is "approved users only". Project B adds "of that ministry". |
| **P5** | Any coordinator can export any cohort's names | ✅ Leave as is |
| **P6** | 35 functions lack a pinned `search_path`; some admin functions callable without sign-in (they refuse internally) | Fixed across the board in Project B (§5) |
| **P7** | Photo buckets are public | ✅ Stay public for now. **Reminder owed to you:** discuss private buckets before any children's ministry launches (§16). |
| **P8** | Eastern timezone hard-coded in 14 places | ✅ **Always use the App Settings timezone** (Project A) |
| **P9** | Version Control editable by any Admin; revalidates a wrong path | ✅ **Church Admin function, edited once, shown in all ministries** (Project B console). Path bug fixed in Project A. |
| **P10** | Orphaned `prod.handle_new_user()`; QA `zz_snapshot_*` tables | ✅ Drop (Project A). The QA tables go first. `prod.handle_new_user()` doesn't exist in QA, so its drop is tested as a script in QA (confirming nothing references it) and then run in production with your go-ahead. |
| **P11** | Docs state single-tenant | Updated in Project B |
| **P12** 🔄 **new** | New sign-ins store their **Google avatar web link** as `photo_path`, but the app treats every `photo_path` as a storage file, so those photos show as **broken images**. **3 production servants** are affected today (0 in QA). | Project A: show a web-link photo correctly (or ignore it), and stop storing avatar links as storage paths. QA first. |

---

## 10. 🔄 v4 Project A: remove hard-coding + clean-ups (done first)

**Goal:** after Project A, **nothing in the code assumes SAY, University, Friday, Eastern time or "Cohort/Youth".** Every ministry-specific value comes from App Settings. SAY's settings reproduce today's behaviour exactly, so SAY users see no difference except the bug fixes.

### 10.1 Inventory of hard-coding to remove

| # | Hard-coded today | Where (examples) | Becomes |
|---|---|---|---|
| A1 | **Eastern timezone** constant | `lib/timezone.ts:11`, used in outreach follow-ups, audit screens, calendar form, check-in forms, outreach screens, Version Control (14 places) | The App Settings timezone (P8) |
| A2 | Fallback timezone `America/New_York`, weekday Friday, cutoff 21:00 | `lib/app-settings.ts:61-63`, `lib/attendance.ts:90-91`, `lib/servant-attendance.ts:65-66`, `app/calendar/actions.ts:33`, `lib/attendance-window.ts:44` | No SAY values in code. If settings can't be read, the page shows an error rather than silently assuming SAY. |
| A3 | "Friday" text | `components/calendar/ServiceCalendarButton.tsx:14-15` | Weekday name from settings |
| A4 | "Yr 0 / Yr 5+ / Yr 1" wording | `components/admin/GroupNamesInteractive.tsx:97,152-153`, `GroupTransitionInteractive.tsx:80-81,129-144` | Built from the group labels and positions in settings. **Terminal-cohort wording itself is left as is** (parked, §16). |
| A5 | "Cohort" | `app/g/[groupId]/layout.tsx:72`, `GroupNamesInteractive.tsx:157`, `AnalyticsInteractive.tsx:363`, template fallback `lib/group-transition.ts:51` | The Group label from settings |
| A6 | "Youth" | `ActionsNeededConfigInteractive.tsx:144,280,285` ("Youth attendance window") | The Member label from settings (the database column name stays; renaming it is cosmetic) |
| A7 | "St Arsanius Youth Ministry" example text | `ActionsNeededConfigInteractive.tsx:107` | A neutral example |
| A8 | `say_` cookie names | `lib/checkin-remember-cookie.ts:12-13` | Neutral names (one-time effect: devices that ticked "remember me" at check-in get asked once more) |
| A9 | Theme colour `#1e3a5f` hard-coded in page headers | e.g. `app/page.tsx:56` and every page header | The Theme colour setting (SAY's is already `#1e3a5f`, so no visible change for SAY) |
| A10 | Servants QR colour `#9B2EBF` and "SAY Servants" label | `lib/qrcodes.ts:9,66-67` | Settings |
| A12 🔄 **v4.1** | Actions Needed counts visits over a fixed **12-month** look-back | `lib/actions-needed.ts:62-64` | New per-ministry setting **`actions_needed_lookback_months`** (default 12, so SAY is unchanged), editable on the Actions Needed settings screen. The Dashboard's help text shows the value. |
| A13 🔄 **v4.1** | Screens slower than they need to be | Audit of every page and helper | Performance pass: remove duplicate and one-after-another database calls, fix queries silently capped at 1,000 rows, add loading screens where there were none, and move audit logging off the critical path. **No change to what any screen shows.** |
| A11 | Generic fallback identity ("Service Members Ministry" etc.) | `lib/app-settings.ts:50-68` | Kept as neutral defaults only (they are not SAY-specific) |

**Reviewed and deliberately left as is** (church-wide, not specific to one ministry; I'm listing them so you can overrule):
- Coptic feast list and Ontario holidays: already on/off options.
- Father of Confession field: church-wide Coptic practice.
- Male/Female.
- North American phone format.
- Calendar event types.

**✅ Decided (28 Sep): leave as is for now.** Grade School uses a parent's email in that field; you'll confirm with the Sunday School admins whether a change is needed. The original question was: new-member check-in **requires an email**. Grade School children may not have one. Should the required intake fields become a per-ministry setting? I suggest deciding this before Grade School's import, not in Project A.

### 10.2 Clean-ups included in Project A

- P1 hard stop in the old tool
- P2 audit-users fix
- P3 remove "mark printed" and the badge
- P4 QR list for approved users only
- P9 Version Control path bug
- P10 drops
- P12 avatar photos
- Remove the QA test account "Tmp Visual Check"'s Admin role

### 10.3 How Project A is tested and released

1. Build on a branch and merge to `qa` only.
2. You and your QA testers check that SAY looks and behaves the same, especially dates and times around midnight, the calendar, outreach follow-ups and check-in cutoff.
3. On your go-ahead, promote to production. The small SQL parts (P2, P3, P4, P10) are run in QA first, then in production with your go-ahead.

---

## 11. Execution plan

**Branching:** everything is built on feature branches and merged to **`qa` only**. Nothing reaches `main`/production without your explicit go-ahead after testing (your standing rule). No exceptions, however small the change.

**Approval gates:** nothing passes a gate without your explicit OK.

| Phase | What happens | Gate |
|---|---|---|
| **A1. Project A build** | §10 changes on a branch; code review | **GA1**: you approve the change list |
| **A2. Project A in QA** | Merge to `qa`; run the SQL parts in QA; testers verify SAY is unchanged | **GA2**: you sign off QA |
| **A3. Project A in production** | Promote to `main`; SQL parts run in `prod` | Your explicit go-ahead |
| **B0. Preparation** | Write the Project B migrations, verification suite (§12) and rollback scripts | **G1**: you approve the SQL + scripts |
| **B1. Backup** | You run a `pg_dump` of `qa` (I'll give you the one-line command; it needs your database password, which I must not handle). Plus an in-database copy of all tables and the "before" fingerprint (§12, V3). | – |
| **B2. Dress rehearsal** | Run the whole migration and the full verification suite **inside one transaction, then roll back**. This tests on real QA data and leaves no trace. | **G2**: you see the results |
| **B3. Database expand (QA)** | Apply the migration for real. The transition fallback keeps the currently deployed QA app working unchanged. Re-run the checks. | – |
| **B4. Code to QA** | Merge to `qa`. Re-run the checks. Smoke test (V7). | **G3** |
| **B5. SAY file move (QA)** | Copy files to `SAY/`, update paths, verify. Old copies are kept. | **G4**: you check photos; then old copies are removed |
| **B6. Contract (QA)** | Switch off the fallback (fail closed); drop the old columns (`app_settings.id`, `qr_codes.printed_at`) | **G5** |
| **B7. Console + test ministry (QA)** | You create a test ministry in the QA console (e.g. code `TST`) with its QA address, following the §3.8 checklist. Seed cohorts, members and servants, including one person who serves in both. Run the two-ministry checklist (V8). | – |
| **B8. 🔄 Acceptance testing (replaces "soak")** | Testers from each ministry, each given **only their ministry's QA address**, work through written scenarios for their role (§12, V9). **Check-in note:** QA only records check-ins on the ministry's configured service day, so testers either test on that weekday or you temporarily set the *QA* ministry's weekday to the test day (QA only). The phase ends when **you** sign off, not on a calendar date. | **G6**: you decide it's ready |
| **Production** | Not part of this approval. Same phases B1–B6 against `prod`, outside SAY's service day. SAY's current production address is recorded so nothing changes for SAY users, posters or icons. New ministries are created in the production console only after QA acceptance and their import (§15). | **Separate explicit go-ahead** |

---

## 12. Verification plan

| # | Check | Pass criterion |
|---|---|---|
| **V1** | **Catalog checks:** every per-ministry table has `ministry_id NOT NULL`, security on, the ministry condition in every rule, and all composite FKs validated. Every definer function has a pinned `search_path`. Only check-in functions are callable without sign-in. | zero violations |
| **V2** | **Data integrity:** row counts identical before and after; no NULL `ministry_id`; every profile, role and join date preserved | exact match |
| **V3** | **Regression fingerprint:** for **every** QA user with a role (~64), simulate them in SQL and record exactly which rows they see in every table, plus every check-in list for every QR code. Taken before, after without a header, and after with `SAY`. Includes every screen that joins to profiles. | identical |
| **V4** | **Isolation matrix:** create a synthetic ministry in a rolled-back transaction. For every role × every table × read/add/change/delete × all functions, prove a ministry-A user can't touch ministry-B data, including with a faked header, a missing header, a foreign QR code and hand-crafted cross-ministry rows. The ministry and address lists can't be read outside the console. | 100% pass |
| **V5** | **Big-function parity:** Group Transition, tiers, rename, merge, remove, archive give the same SAY results before and after, and running them in ministry B leaves SAY byte-identical | identical / untouched |
| **V6** | Supabase security and performance advisors | no new warnings |
| **V7** | **App smoke checklist** (you and testers) for every screen and role, every QR flow, registration and approval, calendar, photos, Group Transition on test data, audit log, branding | all ticked |
| **V8** | **Two-ministry checklist:** each address shows only its own ministry (login page, logo, icon, every page). No page mentions the other. The dual-ministry person signs in separately and sees separate profiles. Unknown address → "not set up". Inactive ministry → "not active" (except Church Admin). Church Admin can open both, and their actions appear in each ministry's audit log. The console is unreachable for non-Church-Admins. Branding is never cached across addresses. | all ticked |
| **V9** | **Tester acceptance scenarios** per ministry and role (B8) | signed off by you |

---

## 13. Rollback plan

| If a problem is found… | Rollback |
|---|---|
| During the dress rehearsal | Nothing to do (rolled back) |
| While a migration file runs | Automatic: each file is one transaction |
| After database expand, before the code | Run the rehearsed "down" script, or restore from the in-database copy or your `pg_dump` |
| After the code deploy | Vercel instant rollback; the database still works with the old code |
| After the file move | Paths are switched back (old files are still there until you approve deletion) |
| After contract | Switch the fallback back on (one statement); dropped columns are restorable from the backup copy |
| Project A | Vercel rollback; each SQL part has its own reverse script |

---

## 14. Risk register

| # | Risk | Likelihood | Impact | Mitigation |
|---|---|---|---|---|
| R1 | A database function misses a ministry filter | Medium without mitigation | High | Composite FKs, per-function spec (§5), V4 covers all functions, V5 checks side effects |
| R2 | A future screen forgets the ministry | High over time | High | The database scopes automatically; V1 becomes a standing check re-run after every future migration |
| R3 | SAY behaviour changes subtly | Medium | Medium | V3 per-user fingerprint; V5 parity; Project A tested separately first |
| R4 | Database/code deploy order mismatch | Medium | High | Expand → code → contract, with the transition fallback |
| R5 | Migration fails half-way | Low | High | One transaction per file; built-in checks; dress rehearsal |
| R6 | Storage change breaks the other environment (as in 0012/0045) | Medium | Medium | Separate QA and production storage files |
| R7 | Performance | Low | Low | Ministry-first indexes; advisors; timing of heaviest screens |
| R9 | Old Sheets tool re-run | Low | Critical | Hard stop in Project A |
| R13 | New ministry's address set up in one place but not another | Medium | Low | Fails closed; console checklist |
| R14 | Faked address or header | Low | None | The header only narrows; roles still required |
| R16 🔄 **new** | One ministry's branding (logo, icon, title) **cached and served on another's address** | Low | Medium | All branded routes rendered per request; V8 checks each address, including the installed icon |
| R17 🔄 **new** | Screens that join to servant names break after the profile key change | Medium | Medium | Every such join is in V3; found in QA, never in production |
| R18 🔄 **new** | Church Admin's broad access (D3) used by mistake in the wrong ministry | Low | Medium | One ministry at a time, header and logo always visible, every action audited in that ministry |
| R19 🔄 **new** | A person serving in two ministries is confused by entering details twice | Low | Low | The registration form explains it's for this ministry; details are pre-filled from their login name and email |
| R20 🔄 **new** | A future import tool deletes or writes into the wrong ministry | Medium | High | §15 rules; composite FKs reject cross-ministry rows; QA dry run first |

(R8, R10, R11, R12 and R15 from earlier versions are resolved by the v4 design and removed.)

---

## 15. 🔄 v4 Rules for future per-ministry import tools

Each new ministry will need a one-time import of its existing data (D6). Every such tool must:

1. **Target exactly one ministry,** named by its code, and refuse to run without it.
2. **Never delete or truncate anything.** Insert only. If a re-run is needed, it must first check the ministry is still empty and refuse otherwise.
3. **Run in QA first** (dry run, then real run), be checked by that ministry's testers, and only then run in production with your explicit go-ahead.
4. Write photos only under that ministry's folder.
5. Produce a report of rows read, inserted and skipped, and reasons for skipping, for you to review.
6. Rely on the database's cross-ministry protections (§3.1) as a safety net, never as the plan.

---

## 16. Parking lot (decided to do later)

1. **P7: private photo buckets.** Reminder owed to you; to discuss before any children's ministry launches.
2. **Terminal cohort redesign.** You'll change the concept. Neither project changes current terminal behaviour.
3. **Required intake fields per ministry** (e.g. email not required for children). Before Grade School's import.
4. **Moving a member between ministries** (e.g. Junior High → High School). Deliberately blocked by the design until designed as a feature.
5. **Church domain** (e.g. `highschool.yourchurch.org`). Optional; would allow one sign-in across ministries and a switcher later.
6. **Switcher between ministries.** Not wanted now; stays a small change later if ever wanted.

---

## Appendix A: earlier revisions

- **v2:** chose one web address per ministry (Option B) instead of one address with a switcher. Added the `ministry_addresses` table, removed the register-page picker, and made the list of ministries unreadable outside the Church Admin tools.
- **v3:** removed the QA-only ministry selector. QA mirrors production exactly, with a QA address per ministry, so testers from different ministries can't reach each other's data.
