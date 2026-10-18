-- 0122_agreement_per_ministry.sql -- EACH MINISTRY'S CONFIDENTIALITY
-- AGREEMENT IS SIGNED SEPARATELY (owner-decided 17 Oct 2026).
-- A signature made in one ministry counted for every ministry, so an HSY
-- servant who landed on SAY was never asked to sign SAY's agreement, and a
-- SAY Admin could see the HSY signature of someone in both. Ministries must
-- not learn about each other, so a signature now only counts, and is only
-- seen, in the ministry it was made in. (The agreement text itself stays one
-- church-wide document.)
-- * agreement_gate(), sign_agreement() ("signed already"),
--   agreement_status_here() (Servant Profiles), pending_onboarding()
--   (Pending Servants): only this ministry's signatures.
-- * agreement_signatures_select: a row is visible only on its own
--   ministry's address (to its signer, that ministry's Admins/GCs, or the
--   Church Admin).
-- Run once per environment, QA first:
--     begin; set local search_path to qa; \i 0122_agreement_per_ministry.sql; commit;
-- Undo with 0122_down_agreement_per_ministry.sql. Writes no audit entries.

do $$
declare
  s text := current_schema();
  v text;
  r record;
begin
  if s not in ('qa', 'prod') then
    raise exception 'Run with search_path set to qa or prod (got %)', s;
  end if;

  for r in
    select * from (values
      ('agreement_gate()',
       'where a.user_id = me.uid and agreement_signature_valid(',
       'where a.user_id = me.uid and a.ministry_id = current_ministry_id() and agreement_signature_valid('),
      ('sign_agreement(integer, text)',
       'where a.user_id = v_uid and agreement_signature_valid(a.version_id, a.signed_at)',
       'where a.user_id = v_uid and a.ministry_id is not distinct from v_m and agreement_signature_valid(a.version_id, a.signed_at)'),
      ('agreement_status_here()',
       'where a.user_id = p.id',
       'where a.user_id = p.id and a.ministry_id = current_ministry_id()'),
      ('pending_onboarding()',
       'where a.user_id = x.resulting_profile_id',
       'where a.user_id = x.resulting_profile_id and a.ministry_id = x.ministry_id')
    ) t(fn, a, b)
  loop
    v := pg_get_functiondef(format('%I.%s', s, r.fn)::regprocedure);
    if (length(v) - length(replace(v, r.a, ''))) / length(r.a) <> 1 then
      raise exception '% has changed; patch it by hand', r.fn;
    end if;
    execute replace(v, r.a, r.b);
  end loop;
end
$$;

drop policy if exists agreement_signatures_select on agreement_signatures;
create policy agreement_signatures_select on agreement_signatures
  for select to authenticated
  using (
    ministry_id = (select current_ministry_id())
    and (
      user_id = (select auth.uid())
      or (select is_church_admin())
      or ((select is_admin_or_gc_in(current_ministry_id()))
          and exists (select 1 from profiles p
                      where p.ministry_id = (select current_ministry_id()) and p.id = agreement_signatures.user_id))
    )
  );
