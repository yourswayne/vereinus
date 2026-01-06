-- RLS policies for profiles (allow users to manage their own profile row)
-- Run via: supabase db remote commit -f supabase/profiles_rls.sql

alter table public.profiles enable row level security;

grant select, insert, update on public.profiles to authenticated;

-- Helper to check shared org membership without relying on organisation_members RLS.
create or replace function public.profile_in_my_org(p_profile uuid)
returns boolean
security definer
set search_path = public
language sql
as $function$
  select exists (
    select 1
    from public.organisation_members me
    join public.organisation_members other
      on other.org_id = me.org_id
    where me.user_id = auth.uid()
      and other.user_id = p_profile
  );
$function$;

grant execute on function public.profile_in_my_org(uuid) to authenticated, service_role;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
    WHERE schemaname = 'public'
      AND tablename = 'profiles'
      AND policyname = 'profiles_select_own'
  ) THEN
    CREATE POLICY profiles_select_own
      ON public.profiles
      FOR SELECT
      USING (auth.uid() = id);
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
    WHERE schemaname = 'public'
      AND tablename = 'profiles'
      AND policyname = 'profiles_select_shared_org'
  ) THEN
    CREATE POLICY profiles_select_shared_org
      ON public.profiles
      FOR SELECT
      USING (public.profile_in_my_org(id));
  ELSE
    ALTER POLICY profiles_select_shared_org
      ON public.profiles
      USING (public.profile_in_my_org(id));
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
    WHERE schemaname = 'public'
      AND tablename = 'profiles'
      AND policyname = 'profiles_insert_own'
  ) THEN
    CREATE POLICY profiles_insert_own
      ON public.profiles
      FOR INSERT
      WITH CHECK (auth.uid() = id);
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
    WHERE schemaname = 'public'
      AND tablename = 'profiles'
      AND policyname = 'profiles_update_own'
  ) THEN
    CREATE POLICY profiles_update_own
      ON public.profiles
      FOR UPDATE
      USING (auth.uid() = id);
  END IF;
END
$$;
