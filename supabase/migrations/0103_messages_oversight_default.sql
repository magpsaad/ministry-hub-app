-- 0103_messages_oversight_default.sql -- owner-requested (8 Oct 2026):
-- by default no one reads other people's conversations in Messages.
-- app_settings.message_oversight now starts at 'none' (0102 had 'gc'), and
-- every ministry still on 'gc' -- set by 0102 itself, not chosen by anyone
-- -- moves to 'none'. A ministry's Admins can still pick General
-- Coordinators (or GCs and System Admins) in Ministry Settings -> Messages.
-- Run once per environment, QA first:
--     begin; set local search_path to qa; \i 0103_messages_oversight_default.sql; commit;
-- Undo with 0103_down_messages_oversight_default.sql.
-- Writes no audit entries.

do $$
begin
  if current_schema() not in ('qa', 'prod') then
    raise exception 'Run with search_path set to qa or prod (got %)', current_schema();
  end if;
end
$$;

alter table app_settings alter column message_oversight set default 'none';
update app_settings set message_oversight = 'none' where message_oversight = 'gc';
