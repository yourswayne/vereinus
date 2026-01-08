-- RLS policies for assignments, task lists, tasks, and assignment attachments.
-- Run via Supabase SQL editor or CLI (supabase db remote commit -f supabase/assignments_tasklists_storage_rls.sql)

-- Ensure task_lists has legacy columns referenced by some policies/clients.
alter table public.task_lists add column if not exists org_id uuid;
alter table public.task_lists add column if not exists group_id uuid;
alter table public.task_lists add column if not exists kind text;

-- Remove legacy policies that can recurse and cause statement timeouts.
drop policy if exists tl_select on public.task_lists;
drop policy if exists tl_update_delete on public.task_lists;

-- Indexes to keep task list and task queries fast under RLS.
create index if not exists task_lists_user_id_idx on public.task_lists(user_id);
create index if not exists task_lists_user_kind_idx on public.task_lists(user_id, kind);
create index if not exists tasks_list_id_idx on public.tasks(list_id);

-- Helper to avoid RLS recursion when checking task list ownership.
create or replace function public.task_list_is_owner(p_list_id uuid)
returns boolean
security definer
set search_path = public
set row_security = off
language sql
as $function$
  select exists (
    select 1
    from public.task_lists tl
    where tl.id = p_list_id
      and tl.user_id = auth.uid()
  );
$function$;

grant execute on function public.task_list_is_owner(uuid) to authenticated, service_role;

alter table public.assignments enable row level security;
alter table public.assignment_submissions enable row level security;
alter table public.calendar_sync_queue enable row level security;
alter table public.personal_calendar_events enable row level security;
alter table public.task_lists enable row level security;
alter table public.tasks enable row level security;

grant select, insert, update, delete on public.assignments to authenticated;
grant select, insert, update, delete on public.assignment_submissions to authenticated;
grant select, insert, delete on public.calendar_sync_queue to authenticated;
grant select, insert, update, delete on public.personal_calendar_events to authenticated;
grant select, insert, update, delete on public.task_lists to authenticated;
grant select, insert, update, delete on public.tasks to authenticated;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
    WHERE schemaname = 'public'
      AND tablename = 'assignments'
      AND policyname = 'assignments_select_org_members'
  ) THEN
    CREATE POLICY assignments_select_org_members
      ON public.assignments
      FOR SELECT
      USING (
        EXISTS (
          SELECT 1
          FROM public.organisation_members om
          WHERE om.org_id = assignments.org_id
            AND om.user_id = auth.uid()
        )
      );
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
    WHERE schemaname = 'public'
      AND tablename = 'assignments'
      AND policyname = 'assignments_insert_teacher'
  ) THEN
    CREATE POLICY assignments_insert_teacher
      ON public.assignments
      FOR INSERT
      WITH CHECK (public.has_org_role(assignments.org_id, ARRAY['director','teacher']));
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
    WHERE schemaname = 'public'
      AND tablename = 'assignments'
      AND policyname = 'assignments_update_teacher'
  ) THEN
    CREATE POLICY assignments_update_teacher
      ON public.assignments
      FOR UPDATE
      USING (public.has_org_role(assignments.org_id, ARRAY['director','teacher']));
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
    WHERE schemaname = 'public'
      AND tablename = 'assignments'
      AND policyname = 'assignments_delete_teacher'
  ) THEN
    CREATE POLICY assignments_delete_teacher
      ON public.assignments
      FOR DELETE
      USING (public.has_org_role(assignments.org_id, ARRAY['director','teacher']));
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
    WHERE schemaname = 'public'
      AND tablename = 'assignment_submissions'
      AND policyname = 'assignment_submissions_select'
  ) THEN
    CREATE POLICY assignment_submissions_select
      ON public.assignment_submissions
      FOR SELECT
      USING (
        EXISTS (
          SELECT 1
          FROM public.assignments a
          JOIN public.organisation_members om
            ON om.org_id = a.org_id
          WHERE a.id = assignment_submissions.assignment_id
            AND om.user_id = auth.uid()
        )
      );
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
    WHERE schemaname = 'public'
      AND tablename = 'assignment_submissions'
      AND policyname = 'assignment_submissions_insert_own'
  ) THEN
    CREATE POLICY assignment_submissions_insert_own
      ON public.assignment_submissions
      FOR INSERT
      WITH CHECK (
        assignment_submissions.user_id = auth.uid()
        AND EXISTS (
          SELECT 1
          FROM public.assignments a
          JOIN public.organisation_members om
            ON om.org_id = a.org_id
          WHERE a.id = assignment_submissions.assignment_id
            AND om.user_id = auth.uid()
        )
      );
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
    WHERE schemaname = 'public'
      AND tablename = 'assignment_submissions'
      AND policyname = 'assignment_submissions_update_own'
  ) THEN
    CREATE POLICY assignment_submissions_update_own
      ON public.assignment_submissions
      FOR UPDATE
      USING (assignment_submissions.user_id = auth.uid());
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
    WHERE schemaname = 'public'
      AND tablename = 'assignment_submissions'
      AND policyname = 'assignment_submissions_delete_own'
  ) THEN
    CREATE POLICY assignment_submissions_delete_own
      ON public.assignment_submissions
      FOR DELETE
      USING (assignment_submissions.user_id = auth.uid());
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
    WHERE schemaname = 'public'
      AND tablename = 'personal_calendar_events'
      AND policyname = 'personal_calendar_events_select_own'
  ) THEN
    CREATE POLICY personal_calendar_events_select_own
      ON public.personal_calendar_events
      FOR SELECT
      USING (personal_calendar_events.user_id = auth.uid());
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
    WHERE schemaname = 'public'
      AND tablename = 'personal_calendar_events'
      AND policyname = 'personal_calendar_events_insert_own'
  ) THEN
    CREATE POLICY personal_calendar_events_insert_own
      ON public.personal_calendar_events
      FOR INSERT
      WITH CHECK (personal_calendar_events.user_id = auth.uid());
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
    WHERE schemaname = 'public'
      AND tablename = 'personal_calendar_events'
      AND policyname = 'personal_calendar_events_update_own'
  ) THEN
    CREATE POLICY personal_calendar_events_update_own
      ON public.personal_calendar_events
      FOR UPDATE
      USING (personal_calendar_events.user_id = auth.uid());
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
    WHERE schemaname = 'public'
      AND tablename = 'personal_calendar_events'
      AND policyname = 'personal_calendar_events_delete_own'
  ) THEN
    CREATE POLICY personal_calendar_events_delete_own
      ON public.personal_calendar_events
      FOR DELETE
      USING (personal_calendar_events.user_id = auth.uid());
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
    WHERE schemaname = 'public'
      AND tablename = 'calendar_sync_queue'
      AND policyname = 'calendar_sync_queue_select_members'
  ) THEN
    CREATE POLICY calendar_sync_queue_select_members
      ON public.calendar_sync_queue
      FOR SELECT
      USING (
        EXISTS (
          SELECT 1
          FROM public.organisation_members om
          WHERE om.org_id = calendar_sync_queue.org_id
            AND om.user_id = auth.uid()
        )
      );
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
    WHERE schemaname = 'public'
      AND tablename = 'calendar_sync_queue'
      AND policyname = 'calendar_sync_queue_insert_director'
  ) THEN
    CREATE POLICY calendar_sync_queue_insert_director
      ON public.calendar_sync_queue
      FOR INSERT
      WITH CHECK (public.has_org_role(calendar_sync_queue.org_id, ARRAY['director']));
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
    WHERE schemaname = 'public'
      AND tablename = 'calendar_sync_queue'
      AND policyname = 'calendar_sync_queue_delete_director'
  ) THEN
    CREATE POLICY calendar_sync_queue_delete_director
      ON public.calendar_sync_queue
      FOR DELETE
      USING (public.has_org_role(calendar_sync_queue.org_id, ARRAY['director']));
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
    WHERE schemaname = 'public'
      AND tablename = 'task_lists'
      AND policyname = 'task_lists_select_own'
  ) THEN
    CREATE POLICY task_lists_select_own
      ON public.task_lists
      FOR SELECT
      USING (task_lists.user_id = auth.uid());
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
    WHERE schemaname = 'public'
      AND tablename = 'task_lists'
      AND policyname = 'task_lists_insert_own'
  ) THEN
    CREATE POLICY task_lists_insert_own
      ON public.task_lists
      FOR INSERT
      WITH CHECK (task_lists.user_id = auth.uid());
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
    WHERE schemaname = 'public'
      AND tablename = 'task_lists'
      AND policyname = 'task_lists_update_own'
  ) THEN
    CREATE POLICY task_lists_update_own
      ON public.task_lists
      FOR UPDATE
      USING (task_lists.user_id = auth.uid());
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
    WHERE schemaname = 'public'
      AND tablename = 'task_lists'
      AND policyname = 'task_lists_delete_own'
  ) THEN
    CREATE POLICY task_lists_delete_own
      ON public.task_lists
      FOR DELETE
      USING (task_lists.user_id = auth.uid());
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
    WHERE schemaname = 'public'
      AND tablename = 'tasks'
      AND policyname = 'tasks_select_own'
  ) THEN
    CREATE POLICY tasks_select_own
      ON public.tasks
      FOR SELECT
      USING (public.task_list_is_owner(tasks.list_id));
  ELSE
    ALTER POLICY tasks_select_own
      ON public.tasks
      USING (public.task_list_is_owner(tasks.list_id));
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
    WHERE schemaname = 'public'
      AND tablename = 'tasks'
      AND policyname = 'tasks_insert_own'
  ) THEN
    CREATE POLICY tasks_insert_own
      ON public.tasks
      FOR INSERT
      WITH CHECK (public.task_list_is_owner(tasks.list_id));
  ELSE
    ALTER POLICY tasks_insert_own
      ON public.tasks
      WITH CHECK (public.task_list_is_owner(tasks.list_id));
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
    WHERE schemaname = 'public'
      AND tablename = 'tasks'
      AND policyname = 'tasks_update_own'
  ) THEN
    CREATE POLICY tasks_update_own
      ON public.tasks
      FOR UPDATE
      USING (public.task_list_is_owner(tasks.list_id));
  ELSE
    ALTER POLICY tasks_update_own
      ON public.tasks
      USING (public.task_list_is_owner(tasks.list_id));
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
    WHERE schemaname = 'public'
      AND tablename = 'tasks'
      AND policyname = 'tasks_delete_own'
  ) THEN
    CREATE POLICY tasks_delete_own
      ON public.tasks
      FOR DELETE
      USING (public.task_list_is_owner(tasks.list_id));
  ELSE
    ALTER POLICY tasks_delete_own
      ON public.tasks
      USING (public.task_list_is_owner(tasks.list_id));
  END IF;
END
$$;

-- Storage bucket for assignment attachments (public)
insert into storage.buckets (id, name, public)
values ('assignment-attachments', 'assignment-attachments', true)
on conflict (id) do nothing;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
    WHERE schemaname = 'storage'
      AND tablename = 'objects'
      AND policyname = 'assignment_attachments_select'
  ) THEN
    CREATE POLICY assignment_attachments_select
      ON storage.objects
      FOR SELECT
      USING (bucket_id = 'assignment-attachments' AND auth.role() = 'authenticated');
  ELSE
    ALTER POLICY assignment_attachments_select
      ON storage.objects
      USING (bucket_id = 'assignment-attachments' AND auth.role() = 'authenticated');
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
    WHERE schemaname = 'storage'
      AND tablename = 'objects'
      AND policyname = 'assignment_attachments_insert'
  ) THEN
    CREATE POLICY assignment_attachments_insert
      ON storage.objects
      FOR INSERT
      WITH CHECK (bucket_id = 'assignment-attachments' AND auth.role() = 'authenticated');
  ELSE
    ALTER POLICY assignment_attachments_insert
      ON storage.objects
      WITH CHECK (bucket_id = 'assignment-attachments' AND auth.role() = 'authenticated');
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
    WHERE schemaname = 'storage'
      AND tablename = 'objects'
      AND policyname = 'assignment_attachments_update'
  ) THEN
    CREATE POLICY assignment_attachments_update
      ON storage.objects
      FOR UPDATE
      USING (bucket_id = 'assignment-attachments' AND auth.role() = 'authenticated');
  ELSE
    ALTER POLICY assignment_attachments_update
      ON storage.objects
      USING (bucket_id = 'assignment-attachments' AND auth.role() = 'authenticated');
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
    WHERE schemaname = 'storage'
      AND tablename = 'objects'
      AND policyname = 'assignment_attachments_delete'
  ) THEN
    CREATE POLICY assignment_attachments_delete
      ON storage.objects
      FOR DELETE
      USING (bucket_id = 'assignment-attachments' AND auth.role() = 'authenticated');
  ELSE
    ALTER POLICY assignment_attachments_delete
      ON storage.objects
      USING (bucket_id = 'assignment-attachments' AND auth.role() = 'authenticated');
  END IF;
END
$$;

-- Storage bucket for chat media (public)
insert into storage.buckets (id, name, public)
values ('chat-media', 'chat-media', true)
on conflict (id) do nothing;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
    WHERE schemaname = 'storage'
      AND tablename = 'objects'
      AND policyname = 'chat_media_select'
  ) THEN
    CREATE POLICY chat_media_select
      ON storage.objects
      FOR SELECT
      USING (bucket_id = 'chat-media' AND auth.role() = 'authenticated');
  ELSE
    ALTER POLICY chat_media_select
      ON storage.objects
      USING (bucket_id = 'chat-media' AND auth.role() = 'authenticated');
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
    WHERE schemaname = 'storage'
      AND tablename = 'objects'
      AND policyname = 'chat_media_insert'
  ) THEN
    CREATE POLICY chat_media_insert
      ON storage.objects
      FOR INSERT
      WITH CHECK (bucket_id = 'chat-media' AND auth.role() = 'authenticated');
  ELSE
    ALTER POLICY chat_media_insert
      ON storage.objects
      WITH CHECK (bucket_id = 'chat-media' AND auth.role() = 'authenticated');
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
    WHERE schemaname = 'storage'
      AND tablename = 'objects'
      AND policyname = 'chat_media_update'
  ) THEN
    CREATE POLICY chat_media_update
      ON storage.objects
      FOR UPDATE
      USING (bucket_id = 'chat-media' AND auth.role() = 'authenticated');
  ELSE
    ALTER POLICY chat_media_update
      ON storage.objects
      USING (bucket_id = 'chat-media' AND auth.role() = 'authenticated');
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
    WHERE schemaname = 'storage'
      AND tablename = 'objects'
      AND policyname = 'chat_media_delete'
  ) THEN
    CREATE POLICY chat_media_delete
      ON storage.objects
      FOR DELETE
      USING (bucket_id = 'chat-media' AND auth.role() = 'authenticated');
  ELSE
    ALTER POLICY chat_media_delete
      ON storage.objects
      USING (bucket_id = 'chat-media' AND auth.role() = 'authenticated');
  END IF;
END
$$;
