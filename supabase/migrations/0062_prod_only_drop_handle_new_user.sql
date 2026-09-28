-- 0062_prod_only_drop_handle_new_user.sql
-- PROD ONLY -- and only after Project A has been tested in QA and the owner
-- gives the go-ahead. The function does not exist in qa, so there is
-- nothing to apply there; the QA step is running the SAFETY CHECK below
-- against prod (read-only) to confirm nothing uses it.
--
-- prod.handle_new_user() is an orphan from the abandoned auth.users-trigger
-- approach (see 0002_core_tables.sql / lib/supabase/ensure-profile.ts).

-- SAFETY CHECK (read-only; must return zero rows before dropping):
--   select tgname, tgrelid::regclass from pg_trigger t
--   join pg_proc p on p.oid = t.tgfoid
--   join pg_namespace n on n.oid = p.pronamespace
--   where p.proname = 'handle_new_user' and n.nspname = 'prod';

drop function if exists prod.handle_new_user();
