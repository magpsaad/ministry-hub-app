-- 0081_checkin_audit_config.sql -- the two check-in audit types (0080a) in each
-- ministry's audit settings, so Audit Logs lists them and its action filter
-- offers them (owner-reported 4 Oct 2026). They're always recorded -- the
-- database writes them whatever the switch says -- and the screen shows them
-- as such. New ministries already get every type (create_ministry).
--     begin; set local search_path to qa; \i 0081_checkin_audit_config.sql; commit;
-- Undo with 0081_down_checkin_audit_config.sql.

do $$
begin
  if current_schema() not in ('qa', 'prod') then
    raise exception 'Run with search_path set to qa or prod (got %)', current_schema();
  end if;
end
$$;

insert into audit_config (ministry_id, action_type, enabled, description)
select m.id, t.action_type::audit_action_type, true, t.description
from ministries m
cross join (values
  ('CHECKIN_REGISTRATION', 'Signed up through a check-in poster (always recorded)'),
  ('CHECKIN_SIGNUP_ALERT', 'More than 10 check-in poster sign-ups within an hour (always recorded)')
) as t(action_type, description)
on conflict (ministry_id, action_type) do nothing;
