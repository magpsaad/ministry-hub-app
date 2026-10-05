-- 0090_agreement_sign_new_servants.sql -- FIX: A NEW SERVANT COULDN'T SIGN THE
-- AGREEMENT (owner-reported 5 Oct 2026: the High School priest, onboarding
-- into HSY, typed his name and got "Couldn't save your signature").
-- Run once per environment, QA first:
--     begin; set local search_path to qa; \i 0090_agreement_sign_new_servants.sql; commit;
-- Undo: re-run the sign_agreement() part of 0086.
--
-- A new servant signs the agreement BEFORE registering, so they have no
-- profile in the ministry yet -- and an audit entry must belong to someone
-- with a profile there (audit_log_user_fkey), so the whole signature was
-- refused. Now the signature is always saved (name, sign-in email, the
-- database's time -- the record of the signing); the AGREEMENT_SIGNED audit
-- entry is written when the signer already has a profile in this ministry.
-- Writes no audit entries itself.

do $$
begin
  if current_schema() not in ('qa', 'prod') then
    raise exception 'Run with search_path set to qa or prod (got %)', current_schema();
  end if;
end
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

  -- A new servant has no profile here yet (they register after signing).
  if v_m is not null and exists (select 1 from profiles p where p.ministry_id = v_m and p.id = v_uid) then
    insert into audit_log (ministry_id, user_id, action_type, details)
    values (v_m, v_uid, 'AGREEMENT_SIGNED',
            jsonb_build_object('version', (select version from agreement_versions where id = v_cur),
                               'signatureId', v_id, 'typedName', v_name));
  end if;
  return v_id;
end
$$;

do $$
begin
  execute format('alter function sign_agreement(integer, text) set search_path = %I, public, pg_temp', current_schema());
  execute 'revoke all on function sign_agreement(integer, text) from public, anon';
  execute 'grant execute on function sign_agreement(integer, text) to authenticated, service_role';
end
$$;
