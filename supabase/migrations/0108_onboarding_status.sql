-- 0108_onboarding_status.sql -- owner-requested (9 Oct 2026): after 0105,
-- approving someone linked their registration at once, so they vanished
-- from Pending Servants -- and with them the useful "not back yet" sign.
-- The first visit after approval matters: it's when they first see the
-- whole app. Now an approved person stays on Pending Servants until they're
-- fully onboarded:
--   "Approved - hasn't opened the app yet"  (first_visit_at is null)
--   "Opened the app - agreement not signed yet" (no current signature;
--     rare, since the app asks for it before registering)
-- then they leave the list.
--
-- * pending_servants.first_visit_at: set the first time they open the app
--   (its home page) after approval -- note_first_visit(), called by the app
--   on each home-page load (it only ever sets it once).
-- * Filled in for approvals made before today from sign-in records: anyone
--   who signed in or used the app after being approved counts as visited;
--   approvals older than 60 days count as visited regardless.
-- * pending_onboarding(): the approved-but-not-onboarded registrations, for
--   Admins / General Coordinators (and the Church Admin), with who approved.
-- Run once per environment, QA first:
--     begin; set local search_path to qa; \i 0108_onboarding_status.sql; commit;
-- Undo with 0108_down_onboarding_status.sql. Writes no audit entries.

do $$
begin
  if current_schema() not in ('qa', 'prod') then
    raise exception 'Run with search_path set to qa or prod (got %)', current_schema();
  end if;
end
$$;

alter table pending_servants add column if not exists first_visit_at timestamptz;

-- Approvals so far: visited if they signed in or used the app afterwards.
update pending_servants x set first_visit_at = x.approved_at
where x.approved_at is not null and x.first_visit_at is null
  and (x.approved_at < now() - interval '60 days'
       or exists (select 1 from auth.users u
                  where u.id = coalesce(x.resulting_profile_id, x.submitted_by_profile_id)
                    and u.last_sign_in_at > x.approved_at)
       or exists (select 1 from auth.sessions s
                  where s.user_id = coalesce(x.resulting_profile_id, x.submitted_by_profile_id)
                    and greatest(s.created_at, coalesce(s.updated_at, s.created_at)) > x.approved_at));

-- The app's home page, every load: my first visit since approval.
create or replace function note_first_visit()
returns void language sql security definer as $$
  update pending_servants set first_visit_at = now()
  where ministry_id = current_ministry_id() and approved_at is not null and first_visit_at is null
    and (resulting_profile_id = auth.uid() or submitted_by_profile_id = auth.uid())
$$;

-- Approved, not fully onboarded yet (Pending Servants).
create or replace function pending_onboarding()
returns table (id uuid, full_name text, phone text, email text, father_of_confession text, gender text,
               registration_comments text, submitted_at timestamptz, approved_at timestamptz,
               approved_by_name text, stage text)
language sql stable security definer as $$
  select x.id, x.full_name, x.phone, x.email, x.father_of_confession, x.gender, x.registration_comments,
         x.submitted_at, x.approved_at,
         (select p.full_name from profiles p where p.ministry_id = x.ministry_id and p.id = x.approved_by),
         case when x.first_visit_at is null or x.resulting_profile_id is null then 'not_opened' else 'agreement' end
  from pending_servants x
  where x.ministry_id = current_ministry_id()
    and (is_admin_or_gc_in(current_ministry_id()) or is_church_admin())
    and x.approved_at is not null
    and (x.first_visit_at is null
         or x.resulting_profile_id is null
         or not coalesce((select agreement_signature_valid(a.version_id, a.signed_at)
                          from agreement_signatures a
                          where a.user_id = x.resulting_profile_id
                          order by a.signed_at desc limit 1), false))
    and not exists (select 1 from profiles p where p.ministry_id = x.ministry_id
                      and p.id = coalesce(x.resulting_profile_id, x.submitted_by_profile_id) and p.deactivated_at is not null)
  order by x.submitted_at desc
$$;

do $$
declare s text := current_schema(); f text;
begin
  foreach f in array array['note_first_visit()', 'pending_onboarding()'] loop
    execute format('alter function %s set search_path = %I, public, pg_temp', f, s);
    execute format('revoke all on function %s from public, anon, authenticated', f);
    execute format('grant execute on function %s to authenticated, service_role', f);
  end loop;
end
$$;
