-- 0086_down_confidentiality_agreement.sql -- undoes 0086 (removes the agreement,
-- every signature and the grace dates; take a copy first if they matter).
--     begin; set local search_path to qa; \i 0086_down_confidentiality_agreement.sql; commit;
-- The AGREEMENT_SIGNED audit type (0086a) and any audit entries stay.

do $$
begin
  if current_schema() not in ('qa', 'prod') then
    raise exception 'Run with search_path set to qa or prod (got %)', current_schema();
  end if;
end
$$;

drop function if exists agreement_status_here();
drop function if exists sign_agreement(integer, text);
drop function if exists agreement_gate();
drop function if exists agreement_signature_valid(integer, timestamptz);
drop function if exists current_agreement_version_id();
drop table if exists agreement_grace;
drop table if exists agreement_signatures;
drop table if exists agreement_versions;
delete from audit_config where action_type = 'AGREEMENT_SIGNED';
