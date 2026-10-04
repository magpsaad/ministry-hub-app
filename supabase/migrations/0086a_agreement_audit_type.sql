-- 0086a_agreement_audit_type.sql -- the audit type 0086 writes. Run and commit
-- BEFORE 0086 (a new enum value can't be used in the transaction that adds it):
--     begin; set local search_path to qa; \i 0086a_agreement_audit_type.sql; commit;
-- AGREEMENT_SIGNED  someone signed the Servant Confidentiality & Privacy Agreement
-- (Enum values can't be dropped; 0086_down leaves it, unused.)

do $$
begin
  if current_schema() not in ('qa', 'prod') then
    raise exception 'Run with search_path set to qa or prod (got %)', current_schema();
  end if;
end
$$;

alter type audit_action_type add value if not exists 'AGREEMENT_SIGNED';
