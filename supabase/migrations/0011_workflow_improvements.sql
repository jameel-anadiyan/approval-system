-- 0011 — Workflow improvements:
-- 1. Full workflow audit trail: all actions visible to viewers of the request.
-- 2. Head can reject during pending_head_review.
-- 3. Requester sees only their own audio; clerks, heads, admin see all audios.

-- Update all existing audit trail actions to be visible to requesters as well
update public.request_actions set visible_to_requester = true;

-- Update RLS on request_actions so any authenticated viewer of the request sees the full audit trail
drop policy if exists request_actions_select on public.request_actions;
create policy request_actions_select on public.request_actions for select to authenticated
  using (public.can_view_request(request_id));

-- Update request_files_select policy: requesters only see their own voice notes;
-- clerks, heads, and admin can see all audios. Documents are visible to all (except disbursement).
drop policy if exists request_files_select on public.request_files;
create policy request_files_select on public.request_files for select to authenticated
  using (
    (select public.my_role()) <> 'disbursement'
    and public.can_view_request(request_id)
    and (
      kind <> 'voice_note'
      or (select public.my_role()) in ('admin', 'head', 'clerk')
      or added_by is null
      or added_by = (select auth.uid())
    )
  );

-- Update reject_request RPC so Department Head can reject Route A requests during pending_head_review as well
create or replace function public.reject_request(p_request_id uuid, p_remarks text)
returns void language plpgsql security definer set search_path = '' as $$
declare me public.profiles; r public.requests; allowed boolean;
begin
  me := public._me();
  if p_remarks is null or btrim(p_remarks) = '' then raise exception 'A reason is required to reject a request'; end if;
  select * into r from public.requests where id = p_request_id for update;
  if r.id is null or not public.can_view_request(r.id) then raise exception 'Not found'; end if;
  allowed := (r.status in ('pending_head_approval', 'pending_head_review') and me.role = 'head'
                and r.department_id = me.department_id and r.requester_id <> me.id)
          or (r.status = 'pending_admin_approval' and me.role = 'admin');
  if not allowed then raise exception 'You cannot reject this request now'; end if;
  update public.requests set status = 'rejected', decided_by = me.id, decided_at = now(),
    approver_role = me.role, approver_name = me.full_name, updated_at = now() where id = r.id;
  perform public._log_action(r.id, me, 'rejected', r.status, 'rejected', p_remarks, true);
  perform public.notify_next_actor(r.id, 'rejected');
end $$;

-- Update route_request and forward_request so their actions are logged with visible_to_requester = true
create or replace function public.route_request(p_request_id uuid, p_route public.approval_route, p_remarks text default null)
returns void language plpgsql security definer set search_path = '' as $$
declare
  me public.profiles; r public.requests; threshold numeric;
  next_status public.request_status; has_head boolean;
begin
  me := public._me();
  if me.role is distinct from 'clerk' then raise exception 'Only a clerk can route requests'; end if;
  select * into r from public.requests where id = p_request_id for update;
  if r.id is null or r.department_id <> me.department_id then raise exception 'Not found'; end if;
  if r.status <> 'submitted' then raise exception 'Not waiting for clerk routing'; end if;

  select value::numeric into threshold from public.app_settings where key = 'high_value_threshold';
  threshold := coalesce(threshold, 10000);

  select exists (select 1 from public.profiles
    where department_id = r.department_id and role = 'head' and is_active) into has_head;

  if p_route = 'B' then
    if r.amount > threshold then raise exception 'Above threshold: Admin approval required'; end if;
    if r.requester_role = 'head' then raise exception 'A head cannot approve own request'; end if;
    if not has_head then raise exception 'Department has no active head'; end if;
    next_status := 'pending_head_approval';
  elsif r.requester_role = 'head' or not has_head then
    next_status := 'pending_admin_approval';
  else
    next_status := 'pending_head_review';
  end if;

  update public.requests set status = next_status, route = p_route,
    routed_by = me.id, routed_at = now(), updated_at = now() where id = r.id;
  perform public._log_action(r.id, me,
    case when r.requester_id = me.id then 'routed_own_' else 'routed_' end || p_route::text,
    r.status, next_status, p_remarks, true);
  perform public.notify_next_actor(r.id, next_status);
end $$;

create or replace function public.forward_request(p_request_id uuid, p_remarks text default null)
returns void language plpgsql security definer set search_path = '' as $$
declare me public.profiles; r public.requests;
begin
  me := public._me();
  if me.role is distinct from 'head' then raise exception 'Only a head can forward'; end if;
  select * into r from public.requests where id = p_request_id for update;
  if r.id is null or r.department_id <> me.department_id then raise exception 'Not found'; end if;
  if r.status <> 'pending_head_review' then raise exception 'Not waiting for head review'; end if;
  if r.requester_id = me.id then raise exception 'You cannot review your own request'; end if;
  update public.requests set status = 'pending_admin_approval', reviewed_by = me.id,
    reviewed_by_name = me.full_name, reviewed_at = now(), updated_at = now() where id = r.id;
  perform public._log_action(r.id, me, 'forwarded', r.status, 'pending_admin_approval', p_remarks, true);
  perform public.notify_next_actor(r.id, 'pending_admin_approval');
end $$;
