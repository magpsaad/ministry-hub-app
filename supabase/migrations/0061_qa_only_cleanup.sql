-- 0061_qa_only_cleanup.sql
-- QA ONLY. Do NOT run against prod (none of these objects exist there).
-- Project A clean-ups (MULTI_TENANT_PLAN.md P10 + §10.2):
--   * drop the four leftover zz_snapshot_* backup tables
--   * remove the leftover test account "Tmp Visual Check"'s Admin role
-- Hard-codes `qa.` on purpose so it can never touch prod, whatever
-- search_path happens to be.

drop table if exists qa.zz_snapshot_groups;
drop table if exists qa.zz_snapshot_members;
drop table if exists qa.zz_snapshot_qr_codes;
drop table if exists qa.zz_snapshot_user_roles;

delete from qa.user_roles ur
using qa.profiles p
where p.id = ur.user_id
  and p.email = 'tmp-visual-check@example.com'
  and ur.role = 'admin';
