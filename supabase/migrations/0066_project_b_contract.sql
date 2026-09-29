-- 0066_project_b_contract.sql -- PROJECT B, step "contract" (plan §11, B6).
-- Run ONLY after the new code is live in this environment, the SAY files are
-- moved into SAY/ (B5), and the owner has signed off (gate G5):
--     begin; set local search_path to qa; \i 0066_project_b_contract.sql; commit;
--
-- * Switches off the transition fallback: from now on a request that
--   doesn't name its ministry sees nothing and can change nothing (fail
--   closed). The new app always names it (from the web address).
-- * Drops two columns nothing reads any more: app_settings.id (the old
--   single-row marker) and qr_codes.printed_at (Mark as Printed, removed in
--   Project A).
-- Undo with 0066_down_project_b_contract.sql.

do $$
begin
  if to_regclass(current_schema() || '.ministries') is null then raise exception '0064 is not applied'; end if;
  if (select default_ministry_id from tenancy_settings limit 1) is distinct from 'SAY' then
    raise exception 'Expected the transition fallback to still be SAY';
  end if;
end
$$;

update tenancy_settings set default_ministry_id = null;

-- Same function without the printed_at column (result shape changes, so
-- dropped and recreated).
drop function get_qr_codes_with_groups();
create function get_qr_codes_with_groups()
returns table(id uuid, label text, check_in_token uuid, updated_at timestamptz,
              group_id uuid, ladder_position integer, qr_color text)
language sql stable security definer as $$
  select q.id, q.label, q.check_in_token, q.updated_at, q.group_id, g.ladder_position::integer, g.qr_color
  from qr_codes q
  left join groups g on g.id = q.group_id
  where q.ministry_id = current_ministry_id() and is_app_user();
$$;
do $$
begin
  execute format('alter function get_qr_codes_with_groups() set search_path = %I, public, pg_temp', current_schema());
end
$$;
revoke all on function get_qr_codes_with_groups() from public, anon, authenticated;
grant execute on function get_qr_codes_with_groups() to authenticated, service_role;

alter table qr_codes drop column printed_at;
alter table app_settings drop column id;

do $$
begin
  if current_ministry_id() is not null then
    raise exception 'Fail-closed check: a request with no ministry still resolves to %', current_ministry_id();
  end if;
end
$$;

notify pgrst, 'reload schema';
