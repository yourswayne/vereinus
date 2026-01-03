-- Adds profile fields to support username login and full names.
-- Run via: supabase db remote commit -f supabase/profiles_add_fields.sql

alter table public.profiles add column if not exists username text;
alter table public.profiles add column if not exists first_name text;
alter table public.profiles add column if not exists last_name text;
alter table public.profiles add column if not exists email text;

insert into public.profiles (id, display_name, username, first_name, last_name, email)
select
  u.id,
  coalesce(
    nullif(trim(u.raw_user_meta_data->>'display_name'), ''),
    nullif(trim(u.raw_user_meta_data->>'full_name'), ''),
    nullif(trim(concat_ws(' ', u.raw_user_meta_data->>'first_name', u.raw_user_meta_data->>'last_name')), ''),
    u.email
  ),
  nullif(lower(u.raw_user_meta_data->>'username'), ''),
  nullif(u.raw_user_meta_data->>'first_name', ''),
  nullif(u.raw_user_meta_data->>'last_name', ''),
  u.email
from auth.users u
left join public.profiles p on p.id = u.id
where p.id is null;

update public.profiles p
set
  username = coalesce(nullif(lower(u.raw_user_meta_data->>'username'), ''), p.username),
  first_name = coalesce(nullif(u.raw_user_meta_data->>'first_name', ''), p.first_name),
  last_name = coalesce(nullif(u.raw_user_meta_data->>'last_name', ''), p.last_name),
  display_name = coalesce(
    nullif(trim(u.raw_user_meta_data->>'display_name'), ''),
    nullif(trim(u.raw_user_meta_data->>'full_name'), ''),
    nullif(trim(concat_ws(' ', u.raw_user_meta_data->>'first_name', u.raw_user_meta_data->>'last_name')), ''),
    p.display_name
  ),
  email = coalesce(nullif(u.email, ''), p.email)
from auth.users u
where p.id = u.id;

update public.profiles
set username = lower(username)
where username is not null;

create unique index if not exists profiles_username_unique
  on public.profiles (lower(username))
  where username is not null;
