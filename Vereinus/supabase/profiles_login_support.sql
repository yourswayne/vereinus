-- Support username login and keep profiles synced with auth.users.
-- Run after profiles_add_fields.sql:
--   supabase db remote commit -f supabase/profiles_login_support.sql

create or replace function public.resolve_login_email(p_identifier text)
returns text
security definer
set search_path = public, auth
language sql
as $function$
  select u.email
  from public.profiles p
  join auth.users u on u.id = p.id
  where lower(p.username) = lower(p_identifier)
  limit 1;
$function$;

grant execute on function public.resolve_login_email(text) to anon, authenticated, service_role;

create or replace function public.upsert_profile_from_auth()
returns trigger
security definer
set search_path = public, auth
language plpgsql
as $function$
begin
  insert into public.profiles (id, display_name, username, first_name, last_name, email)
  values (
    new.id,
    coalesce(
      nullif(trim(new.raw_user_meta_data->>'display_name'), ''),
      nullif(trim(new.raw_user_meta_data->>'full_name'), ''),
      nullif(trim(concat_ws(' ', new.raw_user_meta_data->>'first_name', new.raw_user_meta_data->>'last_name')), ''),
      new.email
    ),
    nullif(lower(new.raw_user_meta_data->>'username'), ''),
    nullif(new.raw_user_meta_data->>'first_name', ''),
    nullif(new.raw_user_meta_data->>'last_name', ''),
    new.email
  )
  on conflict (id) do update set
    display_name = coalesce(excluded.display_name, public.profiles.display_name),
    username = coalesce(excluded.username, public.profiles.username),
    first_name = coalesce(excluded.first_name, public.profiles.first_name),
    last_name = coalesce(excluded.last_name, public.profiles.last_name),
    email = coalesce(excluded.email, public.profiles.email);
  return new;
end;
$function$;

drop trigger if exists on_auth_user_upsert_profile on auth.users;

create trigger on_auth_user_upsert_profile
after insert or update on auth.users
for each row execute procedure public.upsert_profile_from_auth();
