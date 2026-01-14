-- Adds logo and group image URLs for org/group avatars.
alter table public.organisations add column if not exists logo_url text;
alter table public.groups add column if not exists image_url text;
