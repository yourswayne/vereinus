-- RLS policies for profiles (allow users to manage their own profile row)
-- Run via: supabase db remote commit -f supabase/profiles_rls.sql

alter table public.profiles enable row level security;

grant select, insert, update on public.profiles to authenticated;

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
      USING (
        EXISTS (
          SELECT 1
          FROM public.organisation_members me
          JOIN public.organisation_members other
            ON other.org_id = me.org_id
          WHERE me.user_id = auth.uid()
            AND other.user_id = id
        )
      );
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
