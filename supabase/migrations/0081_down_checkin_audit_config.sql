-- 0081_down_checkin_audit_config.sql -- undoes 0081.
--     begin; set local search_path to qa; \i 0081_down_checkin_audit_config.sql; commit;

delete from audit_config where action_type in ('CHECKIN_REGISTRATION', 'CHECKIN_SIGNUP_ALERT');
