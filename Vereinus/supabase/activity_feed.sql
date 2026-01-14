-- Activity feed schema + triggers (central feed with RLS).
-- Run via Supabase SQL editor or CLI:
--   supabase db remote commit -f supabase/activity_feed.sql

-- Core feed tables.
create table if not exists public.activity_events (
  id uuid primary key default gen_random_uuid(),
  event_key text not null,
  event_type text not null,
  category text not null,
  scope text not null,
  org_id uuid,
  group_id uuid,
  user_id uuid,
  actor_id uuid,
  source_table text not null,
  source_id uuid not null,
  title text,
  message text,
  starts_at timestamp with time zone,
  payload jsonb not null default '{}'::jsonb,
  created_at timestamp with time zone not null default now()
);

create unique index if not exists activity_events_event_key_idx
  on public.activity_events (event_key);
create index if not exists activity_events_org_created_idx
  on public.activity_events (org_id, created_at desc);
create index if not exists activity_events_group_created_idx
  on public.activity_events (group_id, created_at desc);
create index if not exists activity_events_user_created_idx
  on public.activity_events (user_id, created_at desc);
create index if not exists activity_events_source_idx
  on public.activity_events (source_table, source_id);
create index if not exists activity_events_starts_at_idx
  on public.activity_events (starts_at);

create table if not exists public.activity_seen (
  user_id uuid not null,
  event_id uuid not null,
  seen_at timestamp with time zone not null default now(),
  primary key (user_id, event_id),
  constraint activity_seen_user_id_fkey
    foreign key (user_id) references auth.users(id) on delete cascade,
  constraint activity_seen_event_id_fkey
    foreign key (event_id) references public.activity_events(id) on delete cascade
);

create index if not exists activity_seen_user_idx
  on public.activity_seen (user_id, seen_at desc);

alter table public.activity_events enable row level security;
alter table public.activity_seen enable row level security;

grant select on public.activity_events to authenticated;
grant select, insert, update, delete on public.activity_seen to authenticated;

-- Visibility helper (avoid RLS recursion).
create or replace function public.activity_event_visible(
  p_scope text,
  p_org uuid,
  p_group uuid,
  p_user uuid
)
returns boolean
security definer
set search_path = public
set row_security = off
language sql
as $function$
  select case
    when p_scope = 'user' then p_user = auth.uid()
    when p_scope = 'org' then exists (
      select 1
      from public.organisation_members om
      where om.org_id = p_org
        and om.user_id = auth.uid()
    )
    when p_scope = 'group' then exists (
      select 1
      from public.group_members gm
      where gm.group_id = p_group
        and gm.user_id = auth.uid()
    ) or public.has_org_role(p_org, ARRAY['director'])
    else false
  end;
$function$;

grant execute on function public.activity_event_visible(text, uuid, uuid, uuid)
  to authenticated, service_role;

create or replace function public.insert_activity_event(
  p_event_key text,
  p_event_type text,
  p_category text,
  p_scope text,
  p_org uuid,
  p_group uuid,
  p_user uuid,
  p_actor uuid,
  p_source_table text,
  p_source_id uuid,
  p_title text,
  p_message text,
  p_starts_at timestamp with time zone,
  p_payload jsonb default '{}'::jsonb
)
returns void
security definer
set search_path = public
set row_security = off
language plpgsql
as $function$
begin
  insert into public.activity_events (
    event_key,
    event_type,
    category,
    scope,
    org_id,
    group_id,
    user_id,
    actor_id,
    source_table,
    source_id,
    title,
    message,
    starts_at,
    payload
  )
  values (
    p_event_key,
    p_event_type,
    p_category,
    p_scope,
    p_org,
    p_group,
    p_user,
    p_actor,
    p_source_table,
    p_source_id,
    p_title,
    p_message,
    p_starts_at,
    coalesce(p_payload, '{}'::jsonb)
  )
  on conflict (event_key) do nothing;
end;
$function$;

grant execute on function public.insert_activity_event(
  text, text, text, text, uuid, uuid, uuid, uuid, text, uuid, text, text, timestamp with time zone, jsonb
)
to authenticated, service_role;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
    WHERE schemaname = 'public'
      AND tablename = 'activity_events'
      AND policyname = 'activity_events_select'
  ) THEN
    CREATE POLICY activity_events_select
      ON public.activity_events
      FOR SELECT
      USING (public.activity_event_visible(scope, org_id, group_id, user_id));
  ELSE
    ALTER POLICY activity_events_select
      ON public.activity_events
      USING (public.activity_event_visible(scope, org_id, group_id, user_id));
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
    WHERE schemaname = 'public'
      AND tablename = 'activity_seen'
      AND policyname = 'activity_seen_select_own'
  ) THEN
    CREATE POLICY activity_seen_select_own
      ON public.activity_seen
      FOR SELECT
      USING (user_id = auth.uid());
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
    WHERE schemaname = 'public'
      AND tablename = 'activity_seen'
      AND policyname = 'activity_seen_insert_own'
  ) THEN
    CREATE POLICY activity_seen_insert_own
      ON public.activity_seen
      FOR INSERT
      WITH CHECK (user_id = auth.uid());
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
    WHERE schemaname = 'public'
      AND tablename = 'activity_seen'
      AND policyname = 'activity_seen_update_own'
  ) THEN
    CREATE POLICY activity_seen_update_own
      ON public.activity_seen
      FOR UPDATE
      USING (user_id = auth.uid());
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
    WHERE schemaname = 'public'
      AND tablename = 'activity_seen'
      AND policyname = 'activity_seen_delete_own'
  ) THEN
    CREATE POLICY activity_seen_delete_own
      ON public.activity_seen
      FOR DELETE
      USING (user_id = auth.uid());
  END IF;
END
$$;

-- Exercises table (real storage instead of AsyncStorage).
create table if not exists public.exercises (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null,
  group_id uuid,
  title text not null,
  description text,
  attachments jsonb,
  text_styles jsonb,
  created_by uuid,
  updated_by uuid,
  created_at timestamp with time zone not null default now(),
  updated_at timestamp with time zone not null default now(),
  constraint exercises_org_id_fkey
    foreign key (org_id) references public.organisations(id),
  constraint exercises_group_id_fkey
    foreign key (group_id) references public.groups(id),
  constraint exercises_created_by_fkey
    foreign key (created_by) references auth.users(id),
  constraint exercises_updated_by_fkey
    foreign key (updated_by) references auth.users(id)
);

alter table public.exercises add column if not exists text_styles jsonb;

create index if not exists exercises_org_idx on public.exercises (org_id, created_at desc);
create index if not exists exercises_group_idx on public.exercises (group_id, created_at desc);

alter table public.exercises enable row level security;
grant select, insert, update, delete on public.exercises to authenticated;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
    WHERE schemaname = 'public'
      AND tablename = 'exercises'
      AND policyname = 'exercises_select_visible'
  ) THEN
    CREATE POLICY exercises_select_visible
      ON public.exercises
      FOR SELECT
      USING (
        (group_id is null and public.has_org_role(org_id, ARRAY['director','teacher','student']))
        or (group_id is not null and (
          exists (
            select 1 from public.group_members gm
            where gm.group_id = exercises.group_id
              and gm.user_id = auth.uid()
          )
          or public.has_org_role(org_id, ARRAY['director'])
        ))
      );
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
    WHERE schemaname = 'public'
      AND tablename = 'exercises'
      AND policyname = 'exercises_write_org'
  ) THEN
    CREATE POLICY exercises_write_org
      ON public.exercises
      FOR INSERT
      WITH CHECK (public.has_org_role(org_id, ARRAY['director','teacher']));
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
    WHERE schemaname = 'public'
      AND tablename = 'exercises'
      AND policyname = 'exercises_update_org'
  ) THEN
    CREATE POLICY exercises_update_org
      ON public.exercises
      FOR UPDATE
      USING (public.has_org_role(org_id, ARRAY['director','teacher']));
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
    WHERE schemaname = 'public'
      AND tablename = 'exercises'
      AND policyname = 'exercises_delete_org'
  ) THEN
    CREATE POLICY exercises_delete_org
      ON public.exercises
      FOR DELETE
      USING (public.has_org_role(org_id, ARRAY['director','teacher']));
  END IF;
END
$$;

create or replace function public.set_updated_at()
returns trigger
security definer
set search_path = public
language plpgsql
as $function$
begin
  new.updated_at = now();
  return new;
end;
$function$;

drop trigger if exists exercises_set_updated_at on public.exercises;
create trigger exercises_set_updated_at
before update on public.exercises
for each row execute function public.set_updated_at();

-- Announcements -> activity events.
create or replace function public.tg_announcement_activity()
returns trigger
security definer
set search_path = public
set row_security = off
language plpgsql
as $function$
declare
  v_scope text;
  v_key text;
  v_actor uuid;
  v_changed boolean;
begin
  v_scope := case when new.group_id is null then 'org' else 'group' end;
  v_actor := coalesce(auth.uid(), new.author_id);

  if tg_op = 'INSERT' then
    v_key := 'announcement_created:' || new.id;
    perform public.insert_activity_event(
      v_key,
      'announcement_created',
      'announcement',
      v_scope,
      new.org_id,
      new.group_id,
      null,
      v_actor,
      'announcements',
      new.id,
      new.title,
      new.title,
      null,
      jsonb_build_object('event_date', new.event_date)
    );
    return new;
  end if;

  v_changed := coalesce(new.title, '') <> coalesce(old.title, '')
    or coalesce(new.body, '') <> coalesce(old.body, '')
    or coalesce(new.event_date::text, '') <> coalesce(old.event_date::text, '')
    or coalesce(new.group_id::text, '') <> coalesce(old.group_id::text, '');

  if v_changed then
    v_key := 'announcement_updated:' || new.id || ':' ||
      md5(coalesce(new.title, '') || '|' || coalesce(new.body, '') || '|' || coalesce(new.event_date::text, ''));
    perform public.insert_activity_event(
      v_key,
      'announcement_updated',
      'announcement',
      v_scope,
      new.org_id,
      new.group_id,
      null,
      v_actor,
      'announcements',
      new.id,
      new.title,
      new.title,
      null,
      jsonb_build_object('event_date', new.event_date)
    );
  end if;
  return new;
end;
$function$;

drop trigger if exists announcements_activity on public.announcements;
create trigger announcements_activity
after insert or update on public.announcements
for each row execute function public.tg_announcement_activity();

-- Assignments -> activity events.
create or replace function public.tg_assignment_activity()
returns trigger
security definer
set search_path = public
set row_security = off
language plpgsql
as $function$
declare
  v_scope text;
  v_key text;
  v_actor uuid;
  v_changed boolean;
  v_due timestamptz;
  v_has_time boolean;
begin
  v_scope := case when new.group_id is null then 'org' else 'group' end;
  v_actor := coalesce(auth.uid(), new.created_by);

  if tg_op = 'INSERT' then
    v_key := 'assignment_created:' || new.id;
    perform public.insert_activity_event(
      v_key,
      'assignment_created',
      'assignment',
      v_scope,
      new.org_id,
      new.group_id,
      null,
      v_actor,
      'assignments',
      new.id,
      new.title,
      new.title,
      null,
      jsonb_build_object('due_at', new.due_at)
    );

    if new.due_at is not null then
      v_due := new.due_at;
      v_has_time := date_trunc('day', v_due) <> v_due;
      if v_has_time then
        v_key := 'assignment_start:' || new.id || ':' || v_due;
        perform public.insert_activity_event(
          v_key,
          'assignment_start',
          'assignment',
          v_scope,
          new.org_id,
          new.group_id,
          null,
          v_actor,
          'assignments',
          new.id,
          new.title,
          new.title,
          v_due,
          jsonb_build_object('due_at', new.due_at)
        );
      end if;
    end if;
    return new;
  end if;

  v_changed := coalesce(new.title, '') <> coalesce(old.title, '')
    or coalesce(new.description, '') <> coalesce(old.description, '')
    or coalesce(new.due_at::text, '') <> coalesce(old.due_at::text, '')
    or coalesce(new.group_id::text, '') <> coalesce(old.group_id::text, '')
    or coalesce(new.attachment_url, '') <> coalesce(old.attachment_url, '');

  if v_changed then
    v_key := 'assignment_updated:' || new.id || ':' ||
      md5(coalesce(new.title, '') || '|' || coalesce(new.description, '') || '|' || coalesce(new.due_at::text, ''));
    perform public.insert_activity_event(
      v_key,
      'assignment_updated',
      'assignment',
      v_scope,
      new.org_id,
      new.group_id,
      null,
      v_actor,
      'assignments',
      new.id,
      new.title,
      new.title,
      null,
      jsonb_build_object('due_at', new.due_at)
    );
  end if;

  if new.due_at is not null and coalesce(new.due_at::text, '') <> coalesce(old.due_at::text, '') then
    v_due := new.due_at;
    v_has_time := date_trunc('day', v_due) <> v_due;
    if v_has_time then
      v_key := 'assignment_start:' || new.id || ':' || v_due;
      perform public.insert_activity_event(
        v_key,
        'assignment_start',
        'assignment',
        v_scope,
        new.org_id,
        new.group_id,
        null,
        v_actor,
        'assignments',
        new.id,
        new.title,
        new.title,
        v_due,
        jsonb_build_object('due_at', new.due_at)
      );
    end if;
  end if;
  return new;
end;
$function$;

drop trigger if exists assignments_activity on public.assignments;
create trigger assignments_activity
after insert or update on public.assignments
for each row execute function public.tg_assignment_activity();

-- Exercises -> activity events.
create or replace function public.tg_exercise_activity()
returns trigger
security definer
set search_path = public
set row_security = off
language plpgsql
as $function$
declare
  v_scope text;
  v_key text;
  v_actor uuid;
  v_changed boolean;
begin
  v_scope := case when new.group_id is null then 'org' else 'group' end;
  v_actor := coalesce(auth.uid(), new.updated_by, new.created_by);

  if tg_op = 'INSERT' then
    v_key := 'exercise_created:' || new.id;
    perform public.insert_activity_event(
      v_key,
      'exercise_created',
      'exercise',
      v_scope,
      new.org_id,
      new.group_id,
      null,
      v_actor,
      'exercises',
      new.id,
      new.title,
      new.title,
      null,
      jsonb_build_object('attachments', new.attachments)
    );
    return new;
  end if;

  v_changed := coalesce(new.title, '') <> coalesce(old.title, '')
    or coalesce(new.description, '') <> coalesce(old.description, '')
    or coalesce(new.group_id::text, '') <> coalesce(old.group_id::text, '')
    or coalesce(new.attachments::text, '') <> coalesce(old.attachments::text, '')
    or coalesce(new.text_styles::text, '') <> coalesce(old.text_styles::text, '');

  if v_changed then
    v_key := 'exercise_updated:' || new.id || ':' ||
      md5(
        coalesce(new.title, '') || '|' ||
        coalesce(new.description, '') || '|' ||
        coalesce(new.group_id::text, '') || '|' ||
        coalesce(new.attachments::text, '') || '|' ||
        coalesce(new.text_styles::text, '')
      );
    perform public.insert_activity_event(
      v_key,
      'exercise_updated',
      'exercise',
      v_scope,
      new.org_id,
      new.group_id,
      null,
      v_actor,
      'exercises',
      new.id,
      new.title,
      new.title,
      null,
      jsonb_build_object('attachments', new.attachments)
    );
  end if;
  return new;
end;
$function$;

drop trigger if exists exercises_activity on public.exercises;
create trigger exercises_activity
after insert or update on public.exercises
for each row execute function public.tg_exercise_activity();

-- Task list tasks -> activity events.
create or replace function public.tg_task_activity()
returns trigger
security definer
set search_path = public
set row_security = off
language plpgsql
as $function$
declare
  v_kind text;
  v_org uuid;
  v_group uuid;
  v_user uuid;
  v_scope text;
  v_key text;
  v_actor uuid;
  v_changed boolean;
  v_start timestamptz;
  v_has_time boolean;
begin
  select kind, org_id, group_id, user_id
    into v_kind, v_org, v_group, v_user
  from public.task_lists
  where id = new.list_id;

  if v_kind is null then
    return new;
  end if;

  if v_kind = 'user' then
    v_scope := 'user';
    if v_user is null then
      return new;
    end if;
  elsif v_kind = 'group' then
    v_scope := 'group';
  elsif v_kind = 'org' then
    v_scope := 'org';
  else
    return new;
  end if;

  v_actor := coalesce(auth.uid(), v_user);

  if tg_op = 'INSERT' then
    v_key := 'task_created:' || new.id;
    perform public.insert_activity_event(
      v_key,
      'task_created',
      'task',
      v_scope,
      v_org,
      v_group,
      v_user,
      v_actor,
      'tasks',
      new.id,
      new.title,
      new.title,
      null,
      jsonb_build_object('start_at', new.start_at, 'due_at', new.due_at)
    );

    v_start := coalesce(new.start_at, new.due_at);
    if v_start is not null then
      v_has_time := date_trunc('day', v_start) <> v_start;
      if v_has_time then
        v_key := 'task_start:' || new.id || ':' || v_start;
        perform public.insert_activity_event(
          v_key,
          'task_start',
          'task',
          v_scope,
          v_org,
          v_group,
          v_user,
          v_actor,
          'tasks',
          new.id,
          new.title,
          new.title,
          v_start,
          jsonb_build_object('start_at', new.start_at, 'due_at', new.due_at)
        );
      end if;
    end if;
    return new;
  end if;

  v_changed := coalesce(new.title, '') <> coalesce(old.title, '')
    or coalesce(new.description, '') <> coalesce(old.description, '')
    or coalesce(new.start_at::text, '') <> coalesce(old.start_at::text, '')
    or coalesce(new.due_at::text, '') <> coalesce(old.due_at::text, '')
    or coalesce(new.priority, '') <> coalesce(old.priority, '');

  if v_changed then
    v_key := 'task_updated:' || new.id || ':' ||
      md5(
        coalesce(new.title, '') || '|' ||
        coalesce(new.description, '') || '|' ||
        coalesce(new.start_at::text, '') || '|' ||
        coalesce(new.due_at::text, '') || '|' ||
        coalesce(new.priority, '')
      );
    perform public.insert_activity_event(
      v_key,
      'task_updated',
      'task',
      v_scope,
      v_org,
      v_group,
      v_user,
      v_actor,
      'tasks',
      new.id,
      new.title,
      new.title,
      null,
      jsonb_build_object('start_at', new.start_at, 'due_at', new.due_at)
    );
  end if;

  if coalesce(new.start_at::text, '') <> coalesce(old.start_at::text, '')
    or coalesce(new.due_at::text, '') <> coalesce(old.due_at::text, '') then
    v_start := coalesce(new.start_at, new.due_at);
    if v_start is not null then
      v_has_time := date_trunc('day', v_start) <> v_start;
      if v_has_time then
        v_key := 'task_start:' || new.id || ':' || v_start;
        perform public.insert_activity_event(
          v_key,
          'task_start',
          'task',
          v_scope,
          v_org,
          v_group,
          v_user,
          v_actor,
          'tasks',
          new.id,
          new.title,
          new.title,
          v_start,
          jsonb_build_object('start_at', new.start_at, 'due_at', new.due_at)
        );
      end if;
    end if;
  end if;
  return new;
end;
$function$;

drop trigger if exists tasks_activity on public.tasks;
create trigger tasks_activity
after insert or update on public.tasks
for each row execute function public.tg_task_activity();

-- Chat messages -> activity events.
create or replace function public.tg_message_activity()
returns trigger
security definer
set search_path = public
set row_security = off
language plpgsql
as $function$
declare
  v_org uuid;
  v_group uuid;
  v_scope text;
  v_key text;
  v_actor uuid;
  v_title text;
  v_text text;
  v_json jsonb;
begin
  select org_id, group_id
    into v_org, v_group
  from public.channels
  where id = new.channel_id;

  if v_org is null then
    return new;
  end if;

  v_scope := case when v_group is null then 'org' else 'group' end;
  v_actor := coalesce(auth.uid(), new.user_id);

  v_text := coalesce(new.body, '');
  begin
    v_json := v_text::jsonb;
    if jsonb_typeof(v_json) = 'object' and v_json ? 'text' then
      v_text := coalesce(v_json->>'text', v_text);
    end if;
  exception when others then
    null;
  end;

  v_title := nullif(trim(v_text), '');
  if v_title is not null and length(v_title) > 120 then
    v_title := substring(v_title from 1 for 120) || '...';
  end if;

  v_key := 'chat_message_created:' || new.id;
  perform public.insert_activity_event(
    v_key,
    'chat_message_created',
    'chat',
    v_scope,
    v_org,
    v_group,
    null,
    v_actor,
    'messages',
    new.id,
    v_title,
    v_text,
    null,
    jsonb_build_object('channel_id', new.channel_id)
  );
  return new;
end;
$function$;

drop trigger if exists messages_activity on public.messages;
create trigger messages_activity
after insert on public.messages
for each row execute function public.tg_message_activity();

-- Ensure personal_calendar_events has an "end" column (used by triggers + app).
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM information_schema.columns
    WHERE table_schema = 'public'
      AND table_name = 'personal_calendar_events'
      AND column_name = 'end'
  ) THEN
    ALTER TABLE public.personal_calendar_events ADD COLUMN "end" timestamptz;
    IF EXISTS (
      SELECT 1
      FROM information_schema.columns
      WHERE table_schema = 'public'
        AND table_name = 'personal_calendar_events'
        AND column_name = 'end_at'
    ) THEN
      EXECUTE 'UPDATE public.personal_calendar_events SET "end" = end_at WHERE "end" IS NULL';
    END IF;
  END IF;
END
$$;

-- Personal calendar events -> start events.
create or replace function public.tg_personal_calendar_activity()
returns trigger
security definer
set search_path = public
set row_security = off
language plpgsql
as $function$
declare
  v_key text;
  v_start timestamptz;
  v_has_time boolean;
begin
  v_start := new.start;
  v_has_time := date_trunc('day', v_start) <> v_start;
  if v_has_time then
    v_key := 'personal_event_start:' || new.id || ':' || v_start;
    perform public.insert_activity_event(
      v_key,
      'personal_event_start',
      'event',
      'user',
      null,
      null,
      new.user_id,
      coalesce(auth.uid(), new.user_id),
      'personal_calendar_events',
      new.id,
      new.title,
      new.title,
      v_start,
      jsonb_build_object('end', new."end")
    );
  end if;
  return new;
end;
$function$;

drop trigger if exists personal_calendar_activity on public.personal_calendar_events;
create trigger personal_calendar_activity
after insert on public.personal_calendar_events
for each row execute function public.tg_personal_calendar_activity();

-- Org calendar sync queue -> start events.
create or replace function public.tg_calendar_sync_activity()
returns trigger
security definer
set search_path = public
set row_security = off
language plpgsql
as $function$
declare
  v_key text;
  v_start timestamptz;
  v_title text;
  v_source text;
begin
  if new.event_payload is null then
    return new;
  end if;
  v_source := coalesce(new.event_payload->>'source', '');
  if v_source = 'announcement' then
    return new;
  end if;

  v_title := coalesce(new.event_payload->>'title', 'Termin');
  begin
    v_start := (new.event_payload->>'start')::timestamptz;
  exception when others then
    return new;
  end;
  if v_start is null then
    return new;
  end if;
  if date_trunc('day', v_start) = v_start then
    return new;
  end if;

  v_key := 'calendar_event_start:' || new.id || ':' || v_start;
  perform public.insert_activity_event(
    v_key,
    'calendar_event_start',
    'event',
    'org',
    new.org_id,
    null,
    null,
    auth.uid(),
    'calendar_sync_queue',
    new.id,
    v_title,
    v_title,
    v_start,
    jsonb_build_object('payload_id', new.event_payload->>'id')
  );
  return new;
end;
$function$;

drop trigger if exists calendar_sync_activity on public.calendar_sync_queue;
create trigger calendar_sync_activity
after insert on public.calendar_sync_queue
for each row execute function public.tg_calendar_sync_activity();

-- Retention cleanup (default 90 days).
create or replace function public.activity_prune(p_days int default 90)
returns void
security definer
set search_path = public
set row_security = off
language plpgsql
as $function$
declare
  cutoff timestamptz;
begin
  cutoff := now() - make_interval(days => p_days);
  delete from public.activity_events
  where coalesce(starts_at, created_at) < cutoff;
end;
$function$;

grant execute on function public.activity_prune(int) to service_role;

-- Manual run:
-- select public.activity_prune(90);
-- Schedule example (requires pg_cron):
-- select cron.schedule('activity_prune_daily', '0 3 * * *', $$select public.activity_prune(90);$$);
