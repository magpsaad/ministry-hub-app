-- 0080a_checkin_audit_types.sql -- the two audit types 0080 writes. Run and commit
-- BEFORE 0080 (a new enum value can't be used in the transaction that adds it):
--     begin; set local search_path to qa; \i 0080a_checkin_audit_types.sql; commit;
-- CHECKIN_REGISTRATION  someone signed up through a check-in poster
-- CHECKIN_SIGNUP_ALERT  more than 10 such sign-ups within an hour
-- (Enum values can't be dropped; 0080_down leaves them, unused.)

do $$
begin
  if current_schema() not in ('qa', 'prod') then
    raise exception 'Run with search_path set to qa or prod (got %)', current_schema();
  end if;
end
$$;

alter type audit_action_type add value if not exists 'CHECKIN_REGISTRATION';
alter type audit_action_type add value if not exists 'CHECKIN_SIGNUP_ALERT';
