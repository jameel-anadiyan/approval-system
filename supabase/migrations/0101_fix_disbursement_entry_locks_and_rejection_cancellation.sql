-- ============================================================================
-- Migration 0101: Fix missing relation public.disbursement_entry_locks
-- and ensure robust Rejection, Cancellation, Return, and Withdrawal across all roles.
-- ============================================================================

-- 1. Ensure public.request_entry_locks table exists
create table if not exists public.request_entry_locks (
  request_id uuid primary key references public.requests(id) on delete cascade,
  user_id uuid not null references public.profiles(id) on delete cascade,
  user_name text,
  session_id text not null,
  client_label text,
  locked_at timestamptz not null default now(),
  last_heartbeat_at timestamptz not null default now()
);

alter table public.request_entry_locks enable row level security;
grant select, insert, update, delete on public.request_entry_locks to authenticated;

drop policy if exists request_entry_locks_select on public.request_entry_locks;
create policy request_entry_locks_select on public.request_entry_locks
  for select to authenticated using (true);

-- 2. Updatable view so that any legacy code/triggers targeting disbursement_entry_locks operate cleanly
create or replace view public.disbursement_entry_locks as
  select * from public.request_entry_locks;

grant select, insert, update, delete on public.disbursement_entry_locks to authenticated;

comment on view public.disbursement_entry_locks is
  'Alias/view over public.request_entry_locks for backwards-compatibility with cleanup triggers and cancel RPCs';

-- 3. Update terminal status cleanup trigger function
create or replace function public.clean_clarifications_on_request_terminal_status()
returns trigger language plpgsql security definer set search_path = '' as $$
begin
  if NEW.status in ('cancelled', 'rejected', 'withdrawn') then
    -- Decline any pending clarifications
    update public.disbursement_clarifications
    set status = 'declined',
        resolved_at = coalesce(resolved_at, now()),
        responded_at = coalesce(responded_at, now()),
        response_note = coalesce(response_note, 'Request ' || NEW.status),
        updated_at = now()
    where request_id = NEW.id
      and status = 'pending_head';

    -- Mark related clarification notifications as read
    update public.notifications
    set read_at = coalesce(read_at, now())
    where request_id = NEW.id
      and (title ilike '%clarification%' or body ilike '%clarification%');

    -- Cancel non-paid entries
    update public.disbursement_entries
    set status = 'cancelled',
        updated_at = now()
    where request_id = NEW.id
      and status not in ('paid', 'completed');

    -- Clean locks
    delete from public.request_entry_locks
    where request_id = NEW.id;
  end if;
  return NEW;
end;
$$;

drop trigger if exists trg_clean_clarifications_on_terminal_status on public.requests;
create trigger trg_clean_clarifications_on_terminal_status
  after update of status on public.requests
  for each row
  execute function public.clean_clarifications_on_request_terminal_status();

-- 4. Update cancel_approved_request RPC
create or replace function public.cancel_approved_request(p_request_id uuid, p_reason text)
returns void language plpgsql security definer set search_path = '' as $$
declare
  me public.profiles;
  r public.requests;
  ids uuid[];
  v_reason text := btrim(coalesce(p_reason, ''));
begin
  me := public._me();
  select * into r from public.requests where id = p_request_id for update;
  if r.id is null then raise exception 'Not found'; end if;
  if me.role is distinct from 'head' and me.role is distinct from 'admin' then
    raise exception 'Only the request owner Head or Admin can cancel this request';
  end if;
  if me.role = 'head' and not (r.owner_head_id = me.id or r.department_id = me.department_id) then
    raise exception 'Only the request owner Head can cancel this request';
  end if;
  if r.status = 'paid' then raise exception 'This request is already fully paid and can no longer be cancelled'; end if;
  if r.status <> 'approved' then raise exception 'Only approved requests can be cancelled'; end if;
  if char_length(v_reason) < 3 then raise exception 'Please give a reason for cancelling'; end if;

  update public.requests set
    status = 'cancelled',
    cancelled_by = me.id,
    cancelled_by_name = me.full_name,
    cancelled_at = now(),
    cancel_reason = left(v_reason, 1000),
    updated_at = now()
  where id = r.id;

  -- 1. Decline all pending disbursement clarifications for this request
  update public.disbursement_clarifications
  set status = 'declined',
      resolved_at = coalesce(resolved_at, now()),
      responded_at = coalesce(responded_at, now()),
      response_note = coalesce(response_note, 'Approval cancelled: ' || v_reason),
      updated_at = now()
  where request_id = r.id
    and status = 'pending_head';

  -- 2. Mark any clarification notifications as read
  update public.notifications
  set read_at = coalesce(read_at, now())
  where request_id = r.id
    and (title ilike '%clarification%' or body ilike '%clarification%');

  -- 3. Cancel non-paid disbursement entries so they completely leave disbursement account queues
  update public.disbursement_entries
  set status = 'cancelled',
      updated_at = now()
  where request_id = r.id
    and status not in ('paid', 'completed');

  -- 4. Delete any entry locks
  delete from public.request_entry_locks
  where request_id = r.id;

  perform public._log_action(r.id, me, 'cancelled', 'approved', 'cancelled',
    v_reason || case when r.paid_amount > 0
      then ' · ₹' || to_char(r.paid_amount, 'FM999999999990.00') || ' already paid before cancellation' else '' end,
    true);

  select array_agg(id) into ids from public.profiles
   where is_active and id <> me.id and (
     id = r.requester_id
     or (role = 'disbursement' and r.request_type <> 'discount')
     or (role = 'admin' and (r.route = 'A' or r.approver_role = 'admin'))
     or (role in ('clerk','head') and (department_id = r.department_id or id = r.owner_head_id)));
  perform public._notify(ids, r.id, 'Approval cancelled - ' || coalesce(r.approval_no, r.request_no, ''),
    coalesce(r.request_no, 'Request') || ' - ' || r.title || ' · ' || v_reason);
end $$;

revoke execute on function public.cancel_approved_request(uuid, text) from public, anon;
grant execute on function public.cancel_approved_request(uuid, text) to authenticated;

-- 5. Update reject_request RPC with broad head & admin permission checks
create or replace function public.reject_request(p_request_id uuid, p_remarks text)
returns void language plpgsql security definer set search_path = '' as $$
declare
  me public.profiles;
  r public.requests;
  allowed boolean;
begin
  me := public._me();
  if p_remarks is null or btrim(p_remarks) = '' then
    raise exception 'A reason is required to reject a request';
  end if;

  select * into r from public.requests where id = p_request_id for update;
  if r.id is null or not public.can_view_request(r.id) then
    raise exception 'Not found';
  end if;

  allowed := (r.status in ('pending_head_approval', 'pending_head_review', 'approving') and me.role = 'head'
                and (r.department_id = me.department_id or r.owner_head_id = me.id) and r.requester_id <> me.id)
          or (r.status in ('pending_admin_approval', 'approving') and me.role = 'admin')
          or (r.status = 'approved' and (me.role = 'admin' or (me.role = 'head' and (r.owner_head_id = me.id or r.department_id = me.department_id))));

  if not allowed then
    raise exception 'You cannot reject this request now';
  end if;

  update public.requests set
    status = 'rejected',
    decided_by = me.id,
    decided_at = now(),
    approver_role = me.role,
    approver_name = me.full_name,
    updated_at = now()
  where id = r.id;

  -- 1. Decline all pending disbursement clarifications for this request
  update public.disbursement_clarifications
  set status = 'declined',
      resolved_at = coalesce(resolved_at, now()),
      responded_at = coalesce(responded_at, now()),
      response_note = coalesce(response_note, 'Request rejected: ' || btrim(p_remarks)),
      updated_at = now()
  where request_id = r.id
    and status = 'pending_head';

  -- 2. Mark any clarification notifications as read
  update public.notifications
  set read_at = coalesce(read_at, now())
  where request_id = r.id
    and (title ilike '%clarification%' or body ilike '%clarification%');

  -- 3. Cancel non-paid disbursement entries so they leave disbursement queues
  update public.disbursement_entries
  set status = 'cancelled',
      updated_at = now()
  where request_id = r.id
    and status not in ('paid', 'completed');

  -- 4. Delete entry locks
  delete from public.request_entry_locks
  where request_id = r.id;

  perform public._log_action(r.id, me, 'rejected', r.status, 'rejected', p_remarks, true);
  perform public.notify_next_actor(r.id, 'rejected');
end $$;

revoke execute on function public.reject_request(uuid, text) from public, anon;
grant execute on function public.reject_request(uuid, text) to authenticated;

-- 6. Update return_request RPC
create or replace function public.return_request(p_request_id uuid, p_remarks text)
 returns void language plpgsql security definer set search_path to '' as $function$
declare me public.profiles; r public.requests; allowed boolean;
begin
  me := public._me();
  if p_remarks is null or btrim(p_remarks) = '' then raise exception 'A remark is required to return a request'; end if;
  select * into r from public.requests where id = p_request_id for update;
  if r.id is null or not public.can_view_request(r.id) then raise exception 'Not found'; end if;
  allowed := case
    when r.status = 'pending_regional_review' then public._is_regional_actor(r, me)
    when r.status = 'submitted' then me.role = 'clerk' and r.department_id = me.department_id
      and me.id = any(public._clerk_ids_for(r.department_id, r.category_id))
    when r.status in ('pending_head_approval','pending_head_review','approving')
      then me.role = 'head' and (r.department_id = me.department_id or r.owner_head_id = me.id) and r.requester_id <> me.id
    when r.status in ('pending_admin_approval', 'approving') then me.role = 'admin'
    else false end;
  if not allowed then raise exception 'You cannot return this request now'; end if;
  update public.requests set status = 'returned', updated_at = now() where id = r.id;
  perform public._log_action(r.id, me, 'returned', r.status, 'returned', p_remarks, true);
  perform public.notify_next_actor(r.id, 'returned');
end $function$;

revoke execute on function public.return_request(uuid, text) from public, anon;
grant execute on function public.return_request(uuid, text) to authenticated;
