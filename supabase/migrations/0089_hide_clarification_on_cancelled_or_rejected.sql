-- ============================================================================
-- 0089_hide_clarification_on_cancelled_or_rejected.sql
--
-- Automatically decline pending disbursement clarifications and hide/clear
-- clarification notifications and banners when an approved request is cancelled,
-- rejected, or withdrawn.
--
-- 1. Updates `public.reject_request` RPC to decline pending clarifications,
--    mark clarification notifications as read, and cancel non-paid entries.
-- 2. Updates `public.cancel_approved_request` RPC to also mark clarification
--    notifications as read.
-- 3. Creates an automatic trigger `trg_clean_clarifications_on_terminal_status`
--    on `public.requests` whenever status changes to 'cancelled', 'rejected',
--    or 'withdrawn'.
-- 4. Retroactive one-time data cleanup for existing cancelled/rejected requests.
-- ============================================================================

-- 1. Update reject_request RPC
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

  allowed := (r.status in ('pending_head_approval', 'pending_head_review') and me.role = 'head'
                and r.department_id = me.department_id and r.requester_id <> me.id)
          or (r.status = 'pending_admin_approval' and me.role = 'admin')
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
      resolved_at = coalesce(resolved_at, now())
  where request_id = r.id
    and status = 'pending_head';

  -- 2. Mark any clarification notifications as read
  update public.notifications
  set read_at = coalesce(read_at, now())
  where request_id = r.id
    and (title ilike '%clarification%' or body ilike '%clarification%');

  -- 3. Cancel non-paid disbursement entries so they leave disbursement queues
  update public.disbursement_entries
  set status = 'cancelled'
  where request_id = r.id
    and status not in ('paid', 'completed');

  -- 4. Delete entry locks
  delete from public.disbursement_entry_locks
  where request_id = r.id;

  perform public._log_action(r.id, me, 'rejected', r.status, 'rejected', p_remarks, true);
  perform public.notify_next_actor(r.id, 'rejected');
end $$;

revoke execute on function public.reject_request(uuid, text) from public, anon;
grant execute on function public.reject_request(uuid, text) to authenticated;

-- 2. Update cancel_approved_request RPC to also clear clarification notifications
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

  -- 1. Decline all pending disbursement clarifications for this request so no clarification messages remain
  update public.disbursement_clarifications
  set status = 'declined',
      resolved_at = coalesce(resolved_at, now())
  where request_id = r.id
    and status = 'pending_head';

  -- 2. Mark any clarification notifications as read so notification bells clear
  update public.notifications
  set read_at = coalesce(read_at, now())
  where request_id = r.id
    and (title ilike '%clarification%' or body ilike '%clarification%');

  -- 3. Cancel non-paid disbursement entries so they completely leave disbursement account queues
  update public.disbursement_entries
  set status = 'cancelled'
  where request_id = r.id
    and status not in ('paid', 'completed');

  -- 4. Delete any entry locks
  delete from public.disbursement_entry_locks
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
     or (role in ('clerk','head') and department_id = r.department_id));
  perform public._notify(ids, r.id, 'Approval cancelled - ' || coalesce(r.approval_no, r.request_no, ''),
    coalesce(r.request_no, 'Request') || ' - ' || r.title || ' · ' || v_reason);
end $$;

revoke execute on function public.cancel_approved_request(uuid, text) from public, anon;
grant execute on function public.cancel_approved_request(uuid, text) to authenticated;

-- 3. Automatic Trigger to clean up clarifications on terminal status (cancelled, rejected, withdrawn)
create or replace function public.clean_clarifications_on_request_terminal_status()
returns trigger language plpgsql security definer set search_path = '' as $$
begin
  if NEW.status in ('cancelled', 'rejected', 'withdrawn') then
    -- Decline any pending clarifications
    update public.disbursement_clarifications
    set status = 'declined',
        resolved_at = coalesce(resolved_at, now())
    where request_id = NEW.id
      and status = 'pending_head';

    -- Mark related clarification notifications as read
    update public.notifications
    set read_at = coalesce(read_at, now())
    where request_id = NEW.id
      and (title ilike '%clarification%' or body ilike '%clarification%');

    -- Cancel non-paid entries
    update public.disbursement_entries
    set status = 'cancelled'
    where request_id = NEW.id
      and status not in ('paid', 'completed');

    -- Clean locks
    delete from public.disbursement_entry_locks
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

-- 4. One-time data cleanup for existing requests that were cancelled, rejected, or withdrawn
update public.disbursement_clarifications c
set status = 'declined',
    resolved_at = coalesce(c.resolved_at, now())
from public.requests r
where r.id = c.request_id
  and r.status in ('cancelled', 'rejected', 'withdrawn')
  and c.status = 'pending_head';

update public.notifications n
set read_at = coalesce(n.read_at, now())
from public.requests r
where r.id = n.request_id
  and r.status in ('cancelled', 'rejected', 'withdrawn')
  and (n.title ilike '%clarification%' or n.body ilike '%clarification%');

notify pgrst, 'reload schema';
