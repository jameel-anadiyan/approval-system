-- 0018_disbursement_clarifications.sql
-- Disbursement officers can send approved requests back to Head for clarification (with voice or text message)
-- Head can provide clarification and send back to Disbursement (with voice or text message)

create table if not exists public.disbursement_clarifications (
  id uuid primary key default gen_random_uuid(),
  request_id uuid not null references public.requests(id) on delete cascade,
  requested_by uuid not null references public.profiles(id),
  requested_by_name text not null,
  head_id uuid not null references public.profiles(id),
  head_name text not null,
  request_note text,
  request_voice_path text,
  request_voice_duration numeric,
  responded_by uuid references public.profiles(id),
  responded_by_name text,
  response_note text,
  response_voice_path text,
  response_voice_duration numeric,
  responded_at timestamptz,
  status text not null default 'pending_head' check (status in ('pending_head', 'clarified')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists disb_clarif_req_idx on public.disbursement_clarifications(request_id);
create index if not exists disb_clarif_head_idx on public.disbursement_clarifications(head_id, status);

-- RLS on disbursement_clarifications
alter table public.disbursement_clarifications enable row level security;

create policy disb_clarif_select on public.disbursement_clarifications for select to authenticated
  using (
    (select public.my_role()) in ('admin', 'disbursement')
    or head_id = (select auth.uid())
    or requested_by = (select auth.uid())
    or exists (
      select 1 from public.requests r
      where r.id = disbursement_clarifications.request_id
        and (
          (select public.my_role()) in ('clerk','head')
          and r.department_id = (select public.my_department())
        )
    )
  );

-- Update can_add_action_voice to allow disbursement and head clarification audio uploads
create or replace function public.can_add_action_voice(p_request_id uuid)
returns boolean language sql stable security definer set search_path = '' as $$
  select exists (
    select 1 from public.requests r
    join public.profiles me on me.id = auth.uid() and me.is_active
    where r.id = p_request_id and (
      (me.role = 'clerk' and r.department_id = me.department_id and r.status in ('submitted', 'approving'))
      or (me.role = 'head' and r.department_id = me.department_id
          and r.status in ('pending_head_approval','pending_head_review','approving', 'approved') and r.requester_id <> me.id)
      or (me.role = 'admin' and r.status in ('pending_admin_approval','approving'))
      or (me.role = 'head' and exists (
            select 1 from public.head_consultations hc
            where hc.request_id = r.id and hc.head_id = me.id
          ))
      or (me.role = 'disbursement' and r.status = 'approved')
    )
  )
$$;

-- Allow disbursement to read voice notes for approved requests
drop policy if exists "request-files read" on storage.objects;
create policy "request-files read" on storage.objects for select to authenticated
  using (
    bucket_id = 'request-files'
    and (
      ((select public.my_role()) <> 'disbursement' and public.can_view_request(public.storage_request_id(name)))
      or ((select public.my_role()) = 'disbursement' and exists (
        select 1 from public.requests r
        where r.id = public.storage_request_id(name) and r.status in ('approved', 'paid')
      ))
    )
  );

-- RPC: Request clarification from Head
create or replace function public.request_disbursement_clarification(
  p_request_id uuid,
  p_note text default null,
  p_voice_path text default null,
  p_voice_duration numeric default null
)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  me public.profiles;
  r public.requests;
  v_head_id uuid;
  v_head_name text;
  v_clarif_id uuid;
begin
  me := public._me();
  if me.role <> 'disbursement' and me.role <> 'admin' then
    raise exception 'Only Disbursement officers or Admins can request clarifications';
  end if;

  select * into r from public.requests where id = p_request_id;
  if r.id is null then raise exception 'Request not found'; end if;
  if r.status <> 'approved' then raise exception 'Only approved requests can have disbursement clarification'; end if;

  v_head_id := r.owner_head_id;
  v_head_name := r.owner_head_name;

  if v_head_id is null then
    select id, full_name into v_head_id, v_head_name
    from public.profiles
    where department_id = r.department_id and role = 'head' and is_active
    limit 1;
  end if;

  if v_head_id is null then
    raise exception 'No active Department Head assigned to this request';
  end if;

  insert into public.disbursement_clarifications (
    request_id, requested_by, requested_by_name, head_id, head_name,
    request_note, request_voice_path, request_voice_duration, status
  ) values (
    r.id, me.id, me.full_name, v_head_id, v_head_name,
    btrim(coalesce(p_note, '')), p_voice_path, p_voice_duration, 'pending_head'
  ) returning id into v_clarif_id;

  -- Timeline action
  insert into public.request_actions (
    request_id, actor_id, actor_name, actor_role, action, remarks, visible_to_requester
  ) values (
    r.id, me.id, me.full_name, me.role, 'disbursement_clarification_requested',
    coalesce(nullif(btrim(p_note), ''), 'Disbursement sent request to Head for clarification'),
    false
  );

  -- Notification to Head
  insert into public.notifications (user_id, request_id, title, body)
  values (
    v_head_id, r.id,
    'Disbursement Clarification Requested',
    me.full_name || ' (Disbursement) requested clarification on approved request ' || coalesce(r.request_no, '')
  );

  return jsonb_build_object('success', true, 'clarification_id', v_clarif_id);
end;
$$;

-- RPC: Respond to clarification and send back to Disbursement
create or replace function public.respond_disbursement_clarification(
  p_clarification_id uuid,
  p_response_note text default null,
  p_voice_path text default null,
  p_voice_duration numeric default null
)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  me public.profiles;
  c public.disbursement_clarifications;
  r public.requests;
begin
  me := public._me();
  select * into c from public.disbursement_clarifications where id = p_clarification_id;
  if c.id is null then raise exception 'Clarification record not found'; end if;

  if me.role <> 'head' and me.role <> 'admin' then
    raise exception 'Only Department Heads or Admins can respond to disbursement clarification';
  end if;

  select * into r from public.requests where id = c.request_id;

  update public.disbursement_clarifications set
    responded_by = me.id,
    responded_by_name = me.full_name,
    response_note = btrim(coalesce(p_response_note, '')),
    response_voice_path = p_voice_path,
    response_voice_duration = p_voice_duration,
    responded_at = now(),
    status = 'clarified',
    updated_at = now()
  where id = c.id;

  -- Timeline action
  insert into public.request_actions (
    request_id, actor_id, actor_name, actor_role, action, remarks, visible_to_requester
  ) values (
    c.request_id, me.id, me.full_name, me.role, 'disbursement_clarification_provided',
    coalesce(nullif(btrim(p_response_note), ''), 'Head provided clarification and sent back to Disbursement'),
    false
  );

  -- Notify the disbursement user
  insert into public.notifications (user_id, request_id, title, body)
  values (
    c.requested_by, c.request_id,
    'Clarification Provided by Head',
    me.full_name || ' (Head) responded with clarification for request ' || coalesce(r.request_no, '')
  );

  return jsonb_build_object('success', true);
end;
$$;
