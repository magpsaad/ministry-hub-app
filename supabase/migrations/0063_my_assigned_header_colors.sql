-- 0063_my_assigned_header_colors.sql
-- Owner-requested: the group-page header colour shown while "My Assigned
-- List" is ticked becomes an App Setting (was a hard-coded pink gradient,
-- #c2185b -> #d81b60, in components/GroupNavShell.tsx). Defaults reproduce
-- today's colours exactly.
-- Schema-agnostic: run with `set search_path to qa;` first; prod only after
-- QA testing and the owner's go-ahead.

alter table app_settings
  add column if not exists my_assigned_header_color       text not null default '#c2185b',
  add column if not exists my_assigned_header_color_light text not null default '#d81b60';

alter table app_settings drop constraint if exists app_settings_theme_colors_check;
alter table app_settings add constraint app_settings_theme_colors_check check (
  theme_color ~ '^#[0-9A-Fa-f]{6}$'
  and theme_color_light ~ '^#[0-9A-Fa-f]{6}$'
  and theme_color_dark ~ '^#[0-9A-Fa-f]{6}$'
  and servants_qr_color ~ '^#[0-9A-Fa-f]{6}$'
  and my_assigned_header_color ~ '^#[0-9A-Fa-f]{6}$'
  and my_assigned_header_color_light ~ '^#[0-9A-Fa-f]{6}$'
);

notify pgrst, 'reload schema';
