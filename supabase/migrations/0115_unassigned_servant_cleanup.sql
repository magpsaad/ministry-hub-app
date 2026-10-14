-- 0115_unassigned_servant_cleanup.sql -- NO MORE LEFTOVER "UNASSIGNED"
-- SERVANT ROLE (owner-reported 14 Oct 2026). A newly approved servant gets
-- a Servant grant with no group ("Unassigned"). When a Steward then adds
-- them to a group from Servant Assignments, grant_servant_role() inserted a
-- second, grouped Servant grant and left the "Unassigned" one behind -- so
-- the Admin kept cleaning them up by hand.
--
-- * trg_drop_unassigned_servant: once a person holds a Servant grant for a
--   group (new, or an existing one moved to a group), their "Unassigned"
--   Servant grant in that ministry is removed. Every path is covered:
--   Servant Assignments, Access Maintenance, approvals, Coordinator grants.
-- * revoke_role_grant(): revoking a Servant grant now unassigns only the
--   youths of THAT group (revoking "Unassigned" unassigns no one). It used
--   to unassign every youth the person had, in every group.
-- The one-time cleanup of the existing leftovers is in 0115_cleanup (run
-- separately, with the owner's go-ahead for prod).
-- Run once per environment, QA first:
--     begin; set local search_path to qa; \i 0115_unassigned_servant_cleanup.sql; commit;
-- Undo with 0115_down_unassigned_servant_cleanup.sql. Writes no audit entries.

do $$
begin
  if current_schema() not in ('qa', 'prod') then
    raise exception 'Run with search_path set to qa or prod (got %)', current_schema();
  end if;
end
$$;

create or replace function drop_unassigned_servant()
returns trigger language plpgsql security definer as $$
begin
  if new.role = 'servant' and new.group_id is not null then
    delete from user_roles
    where ministry_id = new.ministry_id and user_id = new.user_id
      and role = 'servant' and group_id is null and scope_id is null and id <> new.id;
  end if;
  return new;
end
$$;
drop trigger if exists trg_drop_unassigned_servant on user_roles;
create trigger trg_drop_unassigned_servant after insert or update of group_id on user_roles
  for each row execute function drop_unassigned_servant();

do $$
declare v text;
begin
  v := pg_get_functiondef('revoke_role_grant(uuid)'::regprocedure);
  if position(E'update members set assigned_servant_id = null, is_new_assignment = false\n    where ministry_id = v_m and assigned_servant_id = v_user_id;' in v) = 0 then
    raise exception 'revoke_role_grant has changed; patch it by hand';
  end if;
  execute replace(v,
    E'update members set assigned_servant_id = null, is_new_assignment = false\n    where ministry_id = v_m and assigned_servant_id = v_user_id;',
    E'update members set assigned_servant_id = null, is_new_assignment = false\n    where ministry_id = v_m and assigned_servant_id = v_user_id and v_group is not null and group_id = v_group;');
end
$$;

do $$
declare s text := current_schema();
begin
  execute format('alter function drop_unassigned_servant() set search_path = %I, public, pg_temp', s);
  revoke all on function drop_unassigned_servant() from public, anon, authenticated;
end
$$;
