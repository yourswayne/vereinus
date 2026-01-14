-- Make exercises.org_id cascade when the organisation is deleted
-- Run via Supabase SQL editor or CLI:
--   supabase db remote commit -f supabase/alter_exercises_org_fk_on_delete_cascade.sql

BEGIN;

-- Drop the existing FK (if present)
ALTER TABLE IF EXISTS public.exercises
  DROP CONSTRAINT IF EXISTS exercises_org_id_fkey;

-- Recreate FK with ON DELETE CASCADE so deleting an organisation removes exercises
ALTER TABLE IF EXISTS public.exercises
  ADD CONSTRAINT exercises_org_id_fkey
  FOREIGN KEY (org_id) REFERENCES public.organisations(id) ON DELETE CASCADE;

COMMIT;