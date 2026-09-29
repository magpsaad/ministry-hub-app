-- 0065_down_prod_storage_policies.sql -- PRODUCTION ONLY. Restores the prod-* storage
-- rules exactly as they were before 0065 (as captured from the live catalog
-- on 28 Sep 2026). Never touches qa-* rules.

drop policy if exists "prod-photos_insert" on storage.objects;
create policy "prod-photos_insert" on storage.objects for insert to authenticated
  with check (bucket_id = 'prod-photos' and prod.is_app_user());
drop policy if exists "prod-photos_update" on storage.objects;
create policy "prod-photos_update" on storage.objects for update to authenticated
  using (bucket_id = 'prod-photos' and prod.is_app_user());
drop policy if exists "prod-photos_delete" on storage.objects;
create policy "prod-photos_delete" on storage.objects for delete to authenticated
  using (bucket_id = 'prod-photos' and prod.is_app_user());

drop policy if exists "prod-calendar_insert" on storage.objects;
create policy "prod-calendar_insert" on storage.objects for insert to authenticated
  with check (bucket_id = 'prod-calendar' and prod.is_app_user());
drop policy if exists "prod-calendar_update" on storage.objects;
create policy "prod-calendar_update" on storage.objects for update to authenticated
  using (bucket_id = 'prod-calendar' and prod.is_app_user());
drop policy if exists "prod-calendar_delete" on storage.objects;
create policy "prod-calendar_delete" on storage.objects for delete to authenticated
  using (bucket_id = 'prod-calendar' and prod.is_app_user());

drop policy if exists "prod-branding_insert" on storage.objects;
create policy "prod-branding_insert" on storage.objects for insert to authenticated
  with check (bucket_id = 'prod-branding' and prod.is_admin());
drop policy if exists "prod-branding_update" on storage.objects;
create policy "prod-branding_update" on storage.objects for update to authenticated
  using (bucket_id = 'prod-branding' and prod.is_admin());
