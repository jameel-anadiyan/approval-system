-- ==============================================================================
-- RUN THIS IN SUPABASE SQL EDITOR TO REVERT ACCIDENTAL REJECTION OF REQ-2026-000044
-- Restores REQ-2026-000044 back to its previous status before rejection
-- ==============================================================================

do $$
declare
  r public.requests;
  last_action public.request_actions;
  target_status public.request_status;
begin
  -- 1. Find the request by request_no
  select * into r
  from public.requests
  where request_no = 'REQ-2026-000044'
  for update;

  if r.id is null then
    raise notice 'Request REQ-2026-000044 not found in public.requests';
    return;
  end if;

  -- 2. Find the last rejection action in request_actions
  select * into last_action
  from public.request_actions
  where request_id = r.id
    and to_status = 'rejected'
  order by created_at desc
  limit 1;

  -- 3. Determine the target status (previous status before rejection)
  if last_action.from_status is not null and last_action.from_status <> 'rejected' then
    target_status := last_action.from_status;
  elsif r.route = 'A' then
    if r.reviewed_at is not null then
      target_status := 'pending_admin_approval';
    else
      target_status := 'pending_head_review';
    end if;
  elsif r.route = 'B' then
    target_status := 'pending_head_approval';
  elsif r.requester_role = 'head' then
    target_status := 'pending_admin_approval';
  else
    target_status := 'pending_head_approval';
  end if;

  -- 4. Update the request status and clear rejection metadata
  update public.requests
  set
    status = target_status,
    decided_by = null,
    decided_at = null,
    approver_role = null,
    approver_name = null,
    updated_at = now()
  where id = r.id;

  -- 5. Log the restoration action in request_actions
  insert into public.request_actions (
    request_id,
    actor_id,
    actor_name,
    actor_role,
    action,
    from_status,
    to_status,
    remarks,
    visible_to_requester
  ) values (
    r.id,
    null,
    'System Admin',
    'admin',
    'revised_from_rejection',
    'rejected',
    target_status,
    'Accidental rejection reverted. Request restored to ' || target_status::text,
    true
  );

  -- 6. Notify next actor
  perform public.notify_next_actor(r.id, target_status);

  raise notice 'Request REQ-2026-000044 successfully restored to status: %', target_status;
end $$;

-- Verify updated status
select id, request_no, title, status, route, amount, created_at, updated_at
from public.requests
where request_no = 'REQ-2026-000044';
