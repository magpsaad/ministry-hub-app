-- 0086_confidentiality_agreement.sql -- SERVANT CONFIDENTIALITY & PRIVACY AGREEMENT
-- (owner-approved 4 Oct 2026). Run once per environment, QA first, AFTER
-- 0086a has been committed, together with the app code that adds
-- /security/agreement:
--     begin; set local search_path to qa; \i 0086_confidentiality_agreement.sql; commit;
-- Undo with 0086_down_confidentiality_agreement.sql.
--
-- * One agreement for the whole church (not per ministry): everyone who
--   uses the app signs it once, whichever ministries they serve in.
-- * agreement_versions keeps every wording ever published, so a signature
--   always shows exactly the text that was signed. A new wording = a new
--   row (version 2, ...): everyone signs again at their next visit.
--   resign_after_months (empty = never) asks people to sign the same
--   version again after that long, e.g. 12 for once a year.
-- * agreement_signatures: who signed which version, the name they typed,
--   their sign-in email and when (the database's clock, never the
--   browser's). Only sign_agreement() adds rows; nobody can change or
--   delete them. Readable by the person themselves, the Church Admin, and
--   an Admin or General Coordinator of a ministry the person belongs to.
-- * agreement_grace: people who may keep using the app unsigned until a
--   date (they are reminded at most once a day). Filled here with everyone
--   who has a role in SAY when this runs, for 14 days. Everyone else --
--   new servants in any ministry, and anyone without a SAY role -- must
--   sign before using the app. Move the date with one UPDATE.
-- * agreement_gate(): what the app's front door needs (must sign now /
--   reminder due). agreement_status_here(): every person in this ministry
--   and their latest signature, for Admins and General Coordinators.
-- * Signing writes an AGREEMENT_SIGNED audit entry under the signer's own
--   name (always recorded). This migration itself writes no audit entries.

do $$
begin
  if current_schema() not in ('qa', 'prod') then
    raise exception 'Run with search_path set to qa or prod (got %)', current_schema();
  end if;
end
$$;

create table if not exists agreement_versions (
  id integer generated always as identity primary key,
  version integer not null unique,
  title text not null,
  body text not null,
  published_at timestamptz not null default now(),
  resign_after_months integer check (resign_after_months is null or resign_after_months between 1 and 60),
  created_at timestamptz not null default now()
);

create table if not exists agreement_signatures (
  id bigint generated always as identity primary key,
  user_id uuid not null references auth.users(id) on delete cascade,
  version_id integer not null references agreement_versions(id),
  typed_name text not null check (char_length(typed_name) between 2 and 120),
  email text,
  signed_at timestamptz not null default now(),
  ministry_id text references ministries(id)
);
create index if not exists agreement_signatures_user_idx on agreement_signatures (user_id, signed_at desc);

create table if not exists agreement_grace (
  user_id uuid primary key references auth.users(id) on delete cascade,
  grace_until timestamptz not null,
  created_at timestamptz not null default now()
);

alter table agreement_versions enable row level security;
alter table agreement_signatures enable row level security;
alter table agreement_grace enable row level security;

drop policy if exists agreement_versions_select on agreement_versions;
create policy agreement_versions_select on agreement_versions for select to authenticated
  using (published_at <= now());

drop policy if exists agreement_signatures_select on agreement_signatures;
create policy agreement_signatures_select on agreement_signatures for select to authenticated
  using (
    user_id = (select auth.uid())
    or (select is_church_admin())
    or ((select is_admin_or_gc_in(current_ministry_id()))
        and exists (select 1 from profiles p
                    where p.ministry_id = (select current_ministry_id()) and p.id = agreement_signatures.user_id))
  );

revoke all on agreement_versions from anon, authenticated;
revoke all on agreement_signatures from anon, authenticated;
revoke all on agreement_grace from anon, authenticated;
grant select on agreement_versions to authenticated;
grant select on agreement_signatures to authenticated;
grant all on agreement_versions, agreement_signatures, agreement_grace to service_role;

-- The version in force now (the latest published).
create or replace function current_agreement_version_id()
returns integer language sql stable security definer as $$
  select id from agreement_versions where published_at <= now()
  order by published_at desc, version desc limit 1;
$$;

-- Does this signature still count for the version in force?
create or replace function agreement_signature_valid(p_version_id integer, p_signed_at timestamptz)
returns boolean language sql stable security definer as $$
  select coalesce((
    select p_version_id = v.id
       and (v.resign_after_months is null or p_signed_at > now() - make_interval(months => v.resign_after_months))
    from agreement_versions v where v.id = current_agreement_version_id()
  ), false);
$$;

-- The front door: no row = no agreement published yet (nothing to sign).
create or replace function agreement_gate()
returns table (must_sign boolean, needs_signature boolean, grace_until timestamptz)
language sql stable security definer as $$
  with me as (select auth.uid() as uid),
  n as (
    select me.uid,
           not exists (select 1 from agreement_signatures a
                       where a.user_id = me.uid and agreement_signature_valid(a.version_id, a.signed_at)) as needs,
           (select g.grace_until from agreement_grace g where g.user_id = me.uid) as grace
    from me
    where me.uid is not null and current_agreement_version_id() is not null
  )
  select n.needs and not coalesce(n.grace > now(), false), n.needs, n.grace from n;
$$;

create or replace function sign_agreement(p_version_id integer, p_typed_name text)
returns bigint language plpgsql security definer as $$
declare
  v_uid uuid := auth.uid();
  v_cur integer := current_agreement_version_id();
  v_name text := regexp_replace(btrim(coalesce(p_typed_name, '')), '\s+', ' ', 'g');
  v_m text := current_ministry_id();
  v_id bigint;
begin
  if v_uid is null then
    raise exception 'Please sign in again';
  end if;
  if v_cur is null or p_version_id is distinct from v_cur then
    raise exception 'The agreement has been updated. Please read the new version.';
  end if;
  if char_length(v_name) < 2 or char_length(v_name) > 120 then
    raise exception 'Type your full name to sign';
  end if;

  -- Signed already (a double click, two tabs): keep the first signature.
  select a.id into v_id from agreement_signatures a
  where a.user_id = v_uid and agreement_signature_valid(a.version_id, a.signed_at)
  order by a.signed_at desc limit 1;
  if v_id is not null then
    return v_id;
  end if;

  if not coalesce(ministry_exists(v_m), false) then
    v_m := null;
  end if;

  insert into agreement_signatures (user_id, version_id, typed_name, email, ministry_id)
  values (v_uid, v_cur, v_name, (select u.email from auth.users u where u.id = v_uid), v_m)
  returning id into v_id;

  if v_m is not null then
    insert into audit_log (ministry_id, user_id, action_type, details)
    values (v_m, v_uid, 'AGREEMENT_SIGNED',
            jsonb_build_object('version', (select version from agreement_versions where id = v_cur),
                               'signatureId', v_id, 'typedName', v_name));
  end if;
  return v_id;
end
$$;

-- Everyone with a profile in this ministry and their latest signature
-- (Admins and General Coordinators of this ministry, and the Church Admin).
create or replace function agreement_status_here()
returns table (user_id uuid, signature_id bigint, version integer, signed_at timestamptz,
               is_current boolean, grace_until timestamptz)
language sql stable security definer as $$
  select p.id, last.id, last.version, last.signed_at,
         coalesce(agreement_signature_valid(last.version_id, last.signed_at), false),
         g.grace_until
  from profiles p
  left join lateral (
    select a.id, a.version_id, v.version, a.signed_at
    from agreement_signatures a join agreement_versions v on v.id = a.version_id
    where a.user_id = p.id
    order by a.signed_at desc limit 1
  ) last on true
  left join agreement_grace g on g.user_id = p.id
  where p.ministry_id = current_ministry_id()
    and (is_admin_or_gc_in(current_ministry_id()) or is_church_admin());
$$;

do $$
declare
  s text := current_schema();
  f text;
begin
  foreach f in array array[
    'current_agreement_version_id()', 'agreement_signature_valid(integer, timestamptz)', 'agreement_gate()',
    'sign_agreement(integer, text)', 'agreement_status_here()'
  ] loop
    execute format('alter function %s set search_path = %I, public, pg_temp', f, s);
    execute format('revoke all on function %s from public, anon', f);
    execute format('grant execute on function %s to authenticated, service_role', f);
  end loop;
end
$$;

-- Audit Logs lists the new type (always recorded, like the check-in ones).
insert into audit_config (ministry_id, action_type, enabled, description)
select m.id, 'AGREEMENT_SIGNED'::audit_action_type, true, 'Signed the confidentiality agreement (always recorded)'
from ministries m
on conflict (ministry_id, action_type) do nothing;

-- Existing SAY servants: two weeks to read and sign.
insert into agreement_grace (user_id, grace_until)
select distinct ur.user_id, now() + interval '14 days'
from user_roles ur
where ur.ministry_id = 'SAY'
on conflict (user_id) do nothing;

-- Version 1, the wording the owner approved on 4 Oct 2026.
insert into agreement_versions (version, title, body)
values (1, 'Servant Confidentiality & Privacy Agreement', $body$
## Why this agreement

Our youth and children, and their families, trust us with their personal information. As a servant, you can see some of that information in the Ministry Hub app so you can care for the youth or children in your class or group. This agreement covers everyone we serve: children in Sunday school, and youth in High School, University and beyond.

This agreement explains, in plain words, how to keep that information safe. Please read it, ask questions about anything unclear, and sign it before you use the app.

## What is confidential

Everything you see in the app about a youth or child, a family or another servant is confidential. This includes:

- Names, ages, birthdays, and school, university or work details
- Phone numbers, email addresses and home addresses
- Parent and guardian information (for children and youth)
- Photos
- Attendance and check-in records
- Notes, follow-ups and anything shared with you in confidence

If you are not sure whether something is confidential, treat it as confidential.

## I will

1. Use the app only for my ministry service: caring for, contacting and following up with the youth or children I serve.
2. Look only at the information I need for my role.
3. Keep my sign-in to myself and sign in only with my own email.
4. Lock my phone and computer with a passcode, and sign out on any shared device.
5. Keep personal details private, even within the church, unless sharing is needed to care for a youth or child.
6. Correct or report any information I know is wrong.

## I will not

1. Share anyone's information with people outside the ministry, including friends, family and other parents.
2. Take screenshots, photos of the screen, or copies of lists or contact details.
3. Use the contact details of youth or children saved on my personal phone for anything other than ministry outreach, or share them with anyone outside the ministry.
4. Post or forward information or photos of youth or children on social media or messaging apps.
5. Let anyone else use my account or look at the app over my shoulder.
6. Use the information for anything unrelated to ministry, such as business, sales or personal favors.
7. Try to see or change information I have not been given access to.

## Photos and private notes

- Photos in the app are for identifying youth or children only. I will not download, share or post them.
- Notes about a youth's or child's personal, family or spiritual life stay between me and the ministry leaders (i.e., the ministry coordinator and priests) who need to know.
- I will write notes respectfully, as if the youth or child themselves, or their parents, might read them.
- If a youth or child tells me something that suggests they or someone else may be at risk of harm, confidentiality does not apply. I will tell my ministry priest right away and follow his direction.

## If something goes wrong

Tell your app administrator within 24 hours if:

- Your phone or computer is lost or stolen
- You think someone else has used your account
- You shared information by mistake
- You see information you should not have access to

Mistakes happen. Reporting quickly lets us protect our youth and children, and you will not be blamed for speaking up.

## When I stop serving

My access to the app will be removed when I stop serving or change roles. I will delete any information about youth or children I still have, such as saved contacts, messages or notes. My promise to keep information confidential continues after I stop serving.

## If this agreement is not followed

The app tracks and records who views and changes information to keep the data accurate and to support the app properly. If malicious activity or hacking is suspected, the account involved may be paused or deactivated until the situation is resolved.

## Signature

By typing my full name and selecting Sign, I confirm that I have read this agreement, I understand it, and I agree to follow it. The app records my name, my email address, and the date and time I signed.

I can read this agreement again at any time from the Account Security page in the app.
$body$)
on conflict (version) do nothing;
