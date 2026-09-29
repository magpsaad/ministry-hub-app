-- 0065_prod_storage_policies.sql -- PRODUCTION ONLY, and only after the QA version has been
-- tested and the owner gives the go-ahead. Mirror of 0065_qa_storage_policies.sql.
-- Run after 0064. Names only the "prod-*" policies and hard-codes prod.* --
-- it can never touch QA's storage rules (lesson of 0012/0045).
--
-- Uploads, replacements and deletions are allowed only inside a folder
-- named for a ministry the uploader serves in: "SAY/members/...",
-- "HSM/calendar/..." (branding: that ministry's Admins). Files still at the
-- old flat paths follow today's rule until they are moved into SAY/.
-- Reading is unchanged: the buckets stay public for now (D5 / P7).

drop policy if exists "prod-photos_insert" on storage.objects;
create policy "prod-photos_insert" on storage.objects for insert to authenticated
  with check (bucket_id = 'prod-photos' and prod.storage_write_allowed(name, false));
drop policy if exists "prod-photos_update" on storage.objects;
create policy "prod-photos_update" on storage.objects for update to authenticated
  using (bucket_id = 'prod-photos' and prod.storage_write_allowed(name, false))
  with check (bucket_id = 'prod-photos' and prod.storage_write_allowed(name, false));
drop policy if exists "prod-photos_delete" on storage.objects;
create policy "prod-photos_delete" on storage.objects for delete to authenticated
  using (bucket_id = 'prod-photos' and prod.storage_write_allowed(name, false));

drop policy if exists "prod-calendar_insert" on storage.objects;
create policy "prod-calendar_insert" on storage.objects for insert to authenticated
  with check (bucket_id = 'prod-calendar' and prod.storage_write_allowed(name, false));
drop policy if exists "prod-calendar_update" on storage.objects;
create policy "prod-calendar_update" on storage.objects for update to authenticated
  using (bucket_id = 'prod-calendar' and prod.storage_write_allowed(name, false))
  with check (bucket_id = 'prod-calendar' and prod.storage_write_allowed(name, false));
drop policy if exists "prod-calendar_delete" on storage.objects;
create policy "prod-calendar_delete" on storage.objects for delete to authenticated
  using (bucket_id = 'prod-calendar' and prod.storage_write_allowed(name, false));

drop policy if exists "prod-branding_insert" on storage.objects;
create policy "prod-branding_insert" on storage.objects for insert to authenticated
  with check (bucket_id = 'prod-branding' and prod.storage_write_allowed(name, true));
drop policy if exists "prod-branding_update" on storage.objects;
create policy "prod-branding_update" on storage.objects for update to authenticated
  using (bucket_id = 'prod-branding' and prod.storage_write_allowed(name, true))
  with check (bucket_id = 'prod-branding' and prod.storage_write_allowed(name, true));
