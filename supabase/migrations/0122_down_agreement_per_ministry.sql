-- 0122_down_agreement_per_ministry.sql -- undoes 0122: a signature in any
-- ministry counts (and is seen) everywhere again.
--     begin; set local search_path to qa; \i 0122_down_agreement_per_ministry.sql; commit;

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
       'where a.user_id = me.uid and a.ministry_id = current_ministry_id() and agreement_signature_valid(',
       'where a.user_id = me.uid and agreement_signature_valid('),
      ('sign_agreement(integer, text)',
       'where a.user_id = v_uid and a.ministry_id is not distinct from v_m and agreement_signature_valid(a.version_id, a.signed_at)',
       'where a.user_id = v_uid and agreement_signature_valid(a.version_id, a.signed_at)'),
      ('agreement_status_here()',
       'where a.user_id = p.id and a.ministry_id = current_ministry_id()',
       'where a.user_id = p.id'),
      ('pending_onboarding()',
       'where a.user_id = x.resulting_profile_id and a.ministry_id = x.ministry_id',
       'where a.user_id = x.resulting_profile_id')
    ) t(fn, a, b)
  loop
    v := pg_get_functiondef(format('%I.%s', s, r.fn)::regprocedure);
    if position(r.a in v) = 0 then
      raise exception '% has changed; restore it by hand', r.fn;
    end if;
    execute replace(v, r.a, r.b);
  end loop;
end
$$;

drop policy if exists agreement_signatures_select on agreement_signatures;
create policy agreement_signatures_select on agreement_signatures
  for select to authenticated
  using (
    user_id = (select auth.uid())
    or (select is_church_admin())
    or ((select is_admin_or_gc_in(current_ministry_id()))
        and exists (select 1 from profiles p
                    where p.ministry_id = (select current_ministry_id()) and p.id = agreement_signatures.user_id))
  );
