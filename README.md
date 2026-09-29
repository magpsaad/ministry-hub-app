# Youth Ministry Management App

Rebuild of the "St Arsanius Youth Ministry" (SAY Ministry) app — from Google Apps Script/Sheets to Next.js + Supabase, hosted free on Vercel — now a **multi-ministry** app: one deployment serves several ministries of the same church, each at its own web address with its data walled off, plus a Church Admin console. See `REQUIREMENTS.md` (functional spec) and `DATABASE_SCHEMA.md` (database design) for the full picture — both are the approved, living source of truth for this project. `MULTI_TENANT_PLAN.md` records the multi-ministry design decisions.

## Repo layout

```
├── REQUIREMENTS.md / .pdf       requirements doc — update this whenever behavior changes
├── DATABASE_SCHEMA.md / .pdf    database design doc — companion to the migrations below
├── SETUP_INSTRUCTIONS.md        step-by-step account setup (Supabase, Google OAuth, GitHub, Vercel)
├── supabase/
│   ├── README.md                how to apply the migrations, and why there are two schemas
│   ├── migrations/               numbered, ordered SQL migration files
│   ├── project_b/                one-off multi-ministry rollout scripts (already run)
│   └── tests/project_b/          rehearsal and cross-ministry isolation checks
└── web/                          the Next.js application (this is what deploys to Vercel)
```

## Status

Live in production (`youth-ministry-app-prod.vercel.app`) and QA (`youth-ministry-app-qa.vercel.app`) for SAY. Multi-ministry support (Project B, migrations 0064–0067) went live on 29 Sep 2026; the Church Admin console is at `church-console-prod.vercel.app` (QA: `church-console-qa.vercel.app`). `SETUP_INSTRUCTIONS.md` describes the original one-time account setup.

## Working agreement

Whenever the app owner reports a bug or questions a decision in the rebuilt app: propose a plan → get approval → implement → update `REQUIREMENTS.md` (and `DATABASE_SCHEMA.md` if the schema changes) so they stay the current source of truth. The app's own version number (independent of Vercel's deployment history) starts at 4.0 — see `REQUIREMENTS.md` §13 for the versioning workflow.
