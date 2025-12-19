-- Function: public.has_org_role
-- Usage: used by invite/create_org RPCs and RLS policies to ensure that the
-- currently authenticated user (auth.uid()) has at least one of the roles
-- provided for the organisation that is being accessed.
--
-- Run this statement inside the Supabase SQL editor or via the Supabase CLI
-- once per project:
--
--   supabase db remote commit -f supabase/has_org_role.sql
--
-- The function is intentionally defined to accept `text[]` so that calls such
-- as `has_org_role(p_org, ARRAY['director','teacher'])` resolve without a cast.

create or replace function public.has_org_role(p_org uuid, p_roles text[])
returns boolean
security definer
set search_path = public
language sql
as $function$
  select exists (
    select 1
    from public.organisation_members om
    where om.org_id = p_org
      and om.user_id = auth.uid()
      and om.role::text = any(p_roles)
  );
$function$;

grant execute on function public.has_org_role(uuid, text[]) to authenticated, service_role;
