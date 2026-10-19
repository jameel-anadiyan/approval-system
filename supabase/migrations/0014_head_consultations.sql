-- 0014 — Inter-Department Head Consultations
-- Allows a department head to request reviews/opinions (agree/disagree) from other department heads
-- before taking action (approving or forwarding to admin).

create type public.head_consultation_status as enum ('pending', 'agreed', 'disagreed');

create table if not exists public.head_consultations (
  id uuid primary key default gen_random_uuid(),
  request_id uuid not null references public.requests(id) on delete cascade,
  requested_by uuid not null references public.profiles(id) on delete cascade,
  requested_by_name text not null,
  head_id uuid not null references public.profiles(id) on delete cascade,
  head_name text not null,
  department_id uuid references public.departments(id) on delete set null,
  department_name text,
  status public.head_consultation_status not null default 'pending',
  request_note text,
  response_remarks text,
  responded_at timestamptz,
  created_at timestamptz not null default now(),
  constraint head_consultations_req_head_unique unique (request_id, head_id)
);

create index if not exists head_consultations_request_idx on public.head_consultations(request_id);
create index if not exists head_consultations_head_idx on public.head_consultations(head_id, status);
create index if not exists head_consultations_requested_by_idx on public.head_consultations(requested_by);

-- Enable RLS
alter table public.head_consultations enable row level security;

-- Consultations select policy
drop policy if exists head_consultations_select on public.head_consultations;
create policy head_consultations_select on public.head_consultations for select to authenticated
  using (
    (select public.my_role()) = 'admin'
    or requested_by = (select auth.uid())
    or head_id = (select auth.uid())
    or public.can_view_request(request_id)
  );

-- Update can_view_request so consulted heads can view the request & its documents
create or replace function public.can_view_request(p_request_id uuid)
returns boolean language sql stable security definer set search_path = '' as $$
  select exists (
    select 1
    from public.requests r
    join public.profiles me on me.id = auth.uid() and me.is_active
    where r.id = p_request_id
      and (
        r.requester_id = me.id
        or (me.role = 'admin' and r.status <> 'draft')
        or (me.role in ('clerk','head') and r.department_id = me.department_id and r.status <> 'draft')
        or (me.role = 'disbursement' and r.status in ('approved','paid'))
        or exists (
          select 1 from public.head_consultations hc
          where hc.request_id = r.id and hc.head_id = me.id
        )
      )
  )
$$;

-- Update requests_select policy so consulted heads can query the request
drop policy if exists requests_select on public.requests;
create policy requests_select on public.requests for select to authenticated
  using (
    (select public.my_role()) is not null and (
      requester_id = (select auth.uid())
      or ((select public.my_role()) = 'admin' and status <> 'draft')
      or ((select public.my_role()) in ('clerk','head')
          and department_id = (select public.my_department()) and status <> 'draft')
      or ((select public.my_role()) = 'disbursement' and status in ('approved','paid'))
      or exists (
        select 1 from public.head_consultations hc
        where hc.request_id = requests.id and hc.head_id = (select auth.uid())
      )
    )
  );

-- Update profiles_select policy so heads can view active heads across departments to consult them
drop policy if exists profiles_select on public.profiles;
create policy profiles_select on public.profiles for select to authenticated
  using (
    id = (select auth.uid())
    or (select public.my_role()) = 'admin'
    or ((select public.my_role()) in ('clerk','head') and department_id = (select public.my_department()))
    or ((select public.my_role()) = 'head' and role = 'head' and is_active)
  );

-- RPC: Request consultations from other department heads
create or replace function public.request_head_consultations(
  p_request_id uuid,
  p_head_ids uuid[],
  p_note text default null
)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  me public.profiles;
  r public.requests;
  target_head public.profiles;
  target_dept public.departments;
  target_id uuid;
  inserted_count int := 0;
  head_names text[] := array[]::text[];
begin
  me := public._me();
  if me.role <> 'head' and me.role <> 'admin' then
    raise exception 'Only Department Heads or Admins can request consultations';
  end if;

  select * into r from public.requests where id = p_request_id for update;
  if r.id is null then
    raise exception 'Request not found';
  end if;

  if me.role = 'head' and r.department_id <> me.department_id then
    raise exception 'You can only request consultations for your department requests';
  end if;

  if r.status not in ('pending_head_approval', 'pending_head_review', 'pending_admin_approval') then
    raise exception 'Consultations can only be requested while under review or approval';
  end if;

  foreach target_id in array p_head_ids loop
    if target_id = me.id then
      continue; -- skip self
    end if;

    select * into target_head from public.profiles where id = target_id and role = 'head' and is_active;
    if target_head.id is not null then
      select * into target_dept from public.departments where id = target_head.department_id;

      insert into public.head_consultations (
        request_id, requested_by, requested_by_name,
        head_id, head_name, department_id, department_name,
        status, request_note
      ) values (
        r.id, me.id, me.full_name,
        target_head.id, target_head.full_name, target_dept.id, target_dept.name,
        'pending', p_note
      )
      on conflict (request_id, head_id) do update set
        request_note = coalesce(excluded.request_note, head_consultations.request_note)
      where head_consultations.status = 'pending';

      head_names := array_append(head_names, target_head.full_name || ' (' || coalesce(target_dept.name, 'Head') || ')');
      inserted_count := inserted_count + 1;

      -- Send in-app notification to the consulted head
      insert into public.notifications (user_id, request_id, title, body)
      values (
        target_head.id,
        r.id,
        'Consultation Request: ' || r.request_no,
        me.full_name || ' requested your opinion on request ' || r.request_no ||
          case when p_note is not null and btrim(p_note) <> '' then ': "' || p_note || '"' else '.' end
      );
    end if;
  end loop;

  if inserted_count > 0 then
    perform public._log_action(
      r.id,
      me,
      'consultation_requested',
      r.status,
      r.status,
      'Requested opinion from: ' || array_to_string(head_names, ', ') ||
        case when p_note is not null and btrim(p_note) <> '' then ' — Note: "' || p_note || '"' else '' end,
      true
    );
  end if;

  return jsonb_build_object('success', true, 'count', inserted_count);
end $$;

-- RPC: Respond to consultation (agree / disagree)
create or replace function public.respond_head_consultation(
  p_consultation_id uuid,
  p_status public.head_consultation_status,
  p_remarks text default null
)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  me public.profiles;
  c public.head_consultations;
  r public.requests;
begin
  me := public._me();
  select * into c from public.head_consultations where id = p_consultation_id for update;
  if c.id is null then
    raise exception 'Consultation record not found';
  end if;

  if c.head_id <> me.id and me.role <> 'admin' then
    raise exception 'Only the assigned department head can respond to this consultation';
  end if;

  if p_status not in ('agreed', 'disagreed') then
    raise exception 'Status must be agreed or disagreed';
  end if;

  select * into r from public.requests where id = c.request_id;

  update public.head_consultations
  set status = p_status,
      response_remarks = p_remarks,
      responded_at = now()
  where id = c.id;

  -- Notify the initiating head
  insert into public.notifications (user_id, request_id, title, body)
  values (
    c.requested_by,
    r.id,
    'Consultation ' || initcap(p_status::text) || ': ' || r.request_no,
    me.full_name || ' (' || upper(p_status::text) || ') on request ' || r.request_no ||
      case when p_remarks is not null and btrim(p_remarks) <> '' then ': "' || p_remarks || '"' else '.' end
  );

  -- Log to workflow audit trail
  perform public._log_action(
    r.id,
    me,
    case when p_status = 'agreed' then 'consultation_agreed' else 'consultation_disagreed' end,
    r.status,
    r.status,
    me.full_name || ' (' || coalesce(c.department_name, 'Head') || ') ' || upper(p_status::text) ||
      case when p_remarks is not null and btrim(p_remarks) <> '' then ' — Remarks: "' || p_remarks || '"' else '' end,
    true
  );

  return jsonb_build_object('success', true);
end $$;

revoke execute on function public.request_head_consultations(uuid, uuid[], text) from public, anon;
grant execute on function public.request_head_consultations(uuid, uuid[], text) to authenticated;

revoke execute on function public.respond_head_consultation(uuid, public.head_consultation_status, text) from public, anon;
grant execute on function public.respond_head_consultation(uuid, public.head_consultation_status, text) to authenticated;
