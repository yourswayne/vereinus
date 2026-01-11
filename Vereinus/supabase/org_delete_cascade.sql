-- Delete organisation cascade helper.
-- Run via Supabase SQL editor or CLI:
--   supabase db remote commit -f supabase/org_delete_cascade.sql

create or replace function public.delete_org_cascade(p_org_id uuid)
returns void
security definer
set search_path = public
set row_security = off
language plpgsql
as $function$
declare
  v_channel_ids uuid[];
  v_group_ids uuid[];
  v_task_list_ids uuid[];
  v_assignment_ids uuid[];
begin
  if not public.has_org_role(p_org_id, ARRAY['director']) then
    raise exception 'not authorized';
  end if;

  select array_agg(id) into v_channel_ids
  from public.channels
  where org_id = p_org_id;

  if v_channel_ids is not null then
    delete from public.messages where channel_id = any (v_channel_ids);
  end if;
  delete from public.channels where org_id = p_org_id;

  delete from public.invitations where org_id = p_org_id;

  select array_agg(id) into v_group_ids
  from public.groups
  where org_id = p_org_id;

  if v_group_ids is not null then
    delete from public.group_members where group_id = any (v_group_ids);
  end if;

  select array_agg(id) into v_assignment_ids
  from public.assignments
  where org_id = p_org_id;

  if v_assignment_ids is not null then
    delete from public.assignment_submissions where assignment_id = any (v_assignment_ids);
  end if;
  delete from public.assignments where org_id = p_org_id;

  delete from public.exercises where org_id = p_org_id;
  delete from public.announcements where org_id = p_org_id;

  select array_agg(id) into v_task_list_ids
  from public.task_lists
  where org_id = p_org_id
     or (v_group_ids is not null and group_id = any (v_group_ids));

  if v_task_list_ids is not null then
    delete from public.task_assignees
    where task_id in (select id from public.tasks where list_id = any (v_task_list_ids));
    delete from public.tasks where list_id = any (v_task_list_ids);
  end if;

  delete from public.task_lists
  where org_id = p_org_id
     or (v_group_ids is not null and group_id = any (v_group_ids));

  delete from public.calendar_sync_queue where org_id = p_org_id;
  if to_regclass('public.calendar_entries') is not null then
    execute 'delete from public.calendar_entries where org_id = $1' using p_org_id;
  end if;

  delete from public.activity_events where org_id = p_org_id;

  delete from public.groups where org_id = p_org_id;
  delete from public.organisation_members where org_id = p_org_id;
  delete from public.organisations where id = p_org_id;
end;
$function$;

grant execute on function public.delete_org_cascade(uuid) to authenticated;
