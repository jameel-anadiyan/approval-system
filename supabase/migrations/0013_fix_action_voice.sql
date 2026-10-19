-- 0013_fix_action_voice.sql
-- 1. Fix can_add_action_voice to allow approvers to attach voice notes when request is approving
-- 2. Lower begin_approval lock timeout from 5 minutes to 1 minute for faster stuck recovery
-- 3. Reset any stuck approving requests back to their previous status

create or replace function public.can_add_action_voice(p_request_id uuid)
returns boolean language sql stable security definer set search_path = '' as $$
  select exists (
    select 1 from public.requests r
    join public.profiles me on me.id = auth.uid() and me.is_active
    where r.id = p_request_id and (
      (me.role = 'clerk' and r.department_id = me.department_id and r.status in ('submitted', 'approving'))
      or (me.role = 'head' and r.department_id = me.department_id
          and r.status in ('pending_head_approval','pending_head_review','approving') and r.requester_id <> me.id)
      or (me.role = 'admin' and r.status in ('pending_admin_approval','approving'))
    )
  )
$$;
revoke execute on function public.can_add_action_voice(uuid) from public, anon;
grant execute on function public.can_add_action_voice(uuid) to authenticated;

create or replace function public.begin_approval(p_request_id uuid, p_approver_id uuid)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  me public.profiles; r public.requests; c public.approver_credentials; d public.departments;
  v_no text; v_prev public.request_status; v_now timestamptz := now();
begin
  select * into me from public.profiles where id = p_approver_id and is_active;
  if me.id is null then raise exception 'Approver not found'; end if;
  select * into r from public.requests where id = p_request_id for update;
  if r.id is null then raise exception 'Not found'; end if;

  if r.status = 'approving' then
    if r.approving_started_at > v_now - interval '1 minute' then
      raise exception 'Approval already in progress';
    end if;
    v_prev := r.status_before_approving;   -- stuck run: allow retry
  else
    v_prev := r.status;
  end if;

  if me.role = 'head' then
    if v_prev <> 'pending_head_approval' or r.department_id <> me.department_id then
      raise exception 'This request is not waiting for your approval';
    end if;
  elsif me.role = 'admin' then
    if v_prev <> 'pending_admin_approval' then raise exception 'This request is not waiting for your approval'; end if;
  else
    raise exception 'Only a Head or Admin can approve';
  end if;
  if r.requester_id = me.id then raise exception 'You cannot approve your own request'; end if;

  select * into c from public.approver_credentials where user_id = me.id;
  if c.seal_path is null or c.signature_path is null then
    raise exception 'Upload your seal and signature before approving';
  end if;

  v_no := coalesce(r.approval_no, public.next_number(
    coalesce((select value #>> '{}' from public.app_settings where key = 'approval_prefix'), 'APR')));

  update public.requests set status = 'approving', approval_no = v_no, approving_by = me.id,
    approving_started_at = v_now, status_before_approving = v_prev, decided_at = v_now,
    last_error = null, updated_at = v_now
  where id = r.id;

  select * into d from public.departments where id = r.department_id;
  return jsonb_build_object(
    'request', jsonb_build_object('id', r.id, 'request_no', r.request_no, 'title', r.title, 'notes', r.notes,
       'amount', r.amount, 'route', r.route, 'requester_name', r.requester_name, 'department', d.name,
       'department_code', d.code, 'submitted_at', r.submitted_at, 'verify_token', r.verify_token,
       'reviewed_by_name', r.reviewed_by_name, 'reviewed_at', r.reviewed_at,
       'request_type', r.request_type, 'details', r.details, 'shop_name', r.shop_name),
    'approval_no', v_no, 'decided_at', v_now,
    'approver', jsonb_build_object('id', me.id, 'full_name', me.full_name, 'designation', me.designation,
       'role', me.role, 'department', (select name from public.departments where id = me.department_id)),
    'seal_path', c.seal_path, 'signature_path', c.signature_path,
    'files', coalesce((select jsonb_agg(jsonb_build_object('id', f.id, 'storage_path', f.storage_path,
       'original_name', f.original_name, 'mime_type', f.mime_type) order by f.sort_order, f.created_at)
       from public.request_files f where f.request_id = r.id and f.kind = 'document'), '[]'::jsonb),
    'timeline', coalesce((select jsonb_agg(jsonb_build_object('actor_name', a.actor_name, 'actor_role', a.actor_role,
       'action', a.action, 'remarks', a.remarks, 'created_at', a.created_at) order by a.created_at)
       from public.request_actions a where a.request_id = r.id), '[]'::jsonb));
end $$;

revoke execute on function public.begin_approval(uuid, uuid) from public, anon, authenticated;
grant execute on function public.begin_approval(uuid, uuid) to service_role;

-- Reset any stuck approving requests
update public.requests
set status = coalesce(status_before_approving, 'pending_admin_approval'),
    approving_by = null,
    approving_started_at = null,
    status_before_approving = null,
    last_error = null
where status = 'approving';
