-- 0065_qa_storage_policies.sql -- QA ONLY (production has its own file,
-- 0065_prod_storage_policies.sql, applied only with the owner's go-ahead).
-- Run after 0064. Names only the "qa-*" policies and hard-codes qa.* --
-- it can never touch production's storage rules (lesson of 0012/0045).
--
-- Uploads, replacements and deletions are allowed only inside a folder
-- named for a ministry the uploader serves in: "SAY/members/...",
-- "HSM/calendar/..." (branding: that ministry's Admins). Files still at the
-- old flat paths follow today's rule until they are moved into SAY/.
-- Reading is unchanged: the buckets stay public for now (D5 / P7).

drop policy if exists "qa-photos_insert" on storage.objects;
create policy "qa-photos_insert" on storage.objects for insert to authenticated
  with check (bucket_id = 'qa-photos' and qa.storage_write_allowed(name, false));
drop policy if exists "qa-photos_update" on storage.objects;
create policy "qa-photos_update" on storage.objects for update to authenticated
  using (bucket_id = 'qa-photos' and qa.storage_write_allowed(name, false))
  with check (bucket_id = 'qa-photos' and qa.storage_write_allowed(name, false));
drop policy if exists "qa-photos_delete" on storage.objects;
create policy "qa-photos_delete" on storage.objects for delete to authenticated
  using (bucket_id = 'qa-photos' and qa.storage_write_allowed(name, false));

drop policy if exists "qa-calendar_insert" on storage.objects;
create policy "qa-calendar_insert" on storage.objects for insert to authenticated
  with check (bucket_id = 'qa-calendar' and qa.storage_write_allowed(name, false));
drop policy if exists "qa-calendar_update" on storage.objects;
create policy "qa-calendar_update" on storage.objects for update to authenticated
  using (bucket_id = 'qa-calendar' and qa.storage_write_allowed(name, false))
  with check (bucket_id = 'qa-calendar' and qa.storage_write_allowed(name, false));
drop policy if exists "qa-calendar_delete" on storage.objects;
create policy "qa-calendar_delete" on storage.objects for delete to authenticated
  using (bucket_id = 'qa-calendar' and qa.storage_write_allowed(name, false));

drop policy if exists "qa-branding_insert" on storage.objects;
create policy "qa-branding_insert" on storage.objects for insert to authenticated
  with check (bucket_id = 'qa-branding' and qa.storage_write_allowed(name, true));
drop policy if exists "qa-branding_update" on storage.objects;
create policy "qa-branding_update" on storage.objects for update to authenticated
  using (bucket_id = 'qa-branding' and qa.storage_write_allowed(name, true))
  with check (bucket_id = 'qa-branding' and qa.storage_write_allowed(name, true));
