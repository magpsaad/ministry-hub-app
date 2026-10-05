-- 0088_down_agreement_v2.sql -- undoes 0088: removes version 2 (refused if
-- anyone has already signed it) and restores the 0086 signature rule.
--     begin; set local search_path to qa; \i 0088_down_agreement_v2.sql; commit;

do $$
begin
  if current_schema() not in ('qa', 'prod') then
    raise exception 'Run with search_path set to qa or prod (got %)', current_schema();
  end if;
  if exists (select 1 from agreement_signatures s join agreement_versions v on v.id = s.version_id where v.version = 2) then
    raise exception 'Version 2 already has signatures -- not removing it';
  end if;
end
$$;

delete from agreement_versions where version = 2;

create or replace function agreement_signature_valid(p_version_id integer, p_signed_at timestamptz)
returns boolean language sql stable security definer as $$
  select coalesce((
    select p_version_id = v.id
       and (v.resign_after_months is null or p_signed_at > now() - make_interval(months => v.resign_after_months))
    from agreement_versions v where v.id = current_agreement_version_id()
  ), false);
$$;

do $$
begin
  execute format('alter function agreement_signature_valid(integer, timestamptz) set search_path = %I, public, pg_temp', current_schema());
  execute 'revoke all on function agreement_signature_valid(integer, timestamptz) from public, anon';
  execute 'grant execute on function agreement_signature_valid(integer, timestamptz) to authenticated, service_role';
end
$$;

alter table agreement_versions drop column if exists accepts_earlier_signatures;
