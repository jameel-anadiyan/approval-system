-- Migration 0015: Enforce Inter-Department Head Consultation rules:
-- 1. Cannot forward to Admin if any consultation is pending or disagreed
-- 2. Cannot approve (Head or Admin) if any consultation is pending or disagreed
-- 3. Support revision in respond_head_consultation with clear audit logging

-- 1. Update forward_request
create or replace function public.forward_request(p_request_id uuid, p_remarks text default null)
returns void language plpgsql security definer set search_path = '' as $$
declare
  me public.profiles;
  r public.requests;
  pending_count int;
  disagreed_count int;
begin
  me := public._me();
  if me.role is distinct from 'head' then raise exception 'Only a head can forward'; end if;
  select * into r from public.requests where id = p_request_id for update;
  if r.id is null or r.department_id <> me.department_id then raise exception 'Not found'; end if;
  if r.status <> 'pending_head_review' then raise exception 'Not waiting for head review'; end if;
  if r.requester_id = me.id then raise exception 'You cannot review your own request'; end if;

  -- Inter-Department Head Consultation checks:
  select count(*) into pending_count
  from public.head_consultations
  where request_id = r.id and status = 'pending';

  if pending_count > 0 then
    raise exception 'Cannot forward: Awaiting review response from % consulted department head(s)', pending_count;
  end if;

  select count(*) into disagreed_count
  from public.head_consultations
  where request_id = r.id and status = 'disagreed';

  if disagreed_count > 0 then
    raise exception 'Cannot forward: % consulted department head(s) disagreed with this request', disagreed_count;
  end if;

  update public.requests set
    status = 'pending_admin_approval',
    reviewed_by = me.id,
    reviewed_by_name = me.full_name,
    reviewed_at = now(),
    updated_at = now()
  where id = r.id;

  perform public._log_action(r.id, me, 'forwarded', r.status, 'pending_admin_approval', p_remarks, true);
  perform public.notify_next_actor(r.id, 'pending_admin_approval');
end $$;

-- 2. Update begin_approval
create or replace function public.begin_approval(p_request_id uuid, p_approver_id uuid)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  me public.profiles;
  r public.requests;
  c public.approver_credentials;
  d public.departments;
  v_no text;
  v_prev public.request_status;
  v_now timestamptz := now();
  pending_count int;
  disagreed_count int;
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

  -- Inter-Department Head Consultation checks:
  select count(*) into pending_count
  from public.head_consultations
  where request_id = r.id and status = 'pending';

  if pending_count > 0 then
    raise exception 'Cannot approve: Awaiting review response from % consulted department head(s)', pending_count;
  end if;

  select count(*) into disagreed_count
  from public.head_consultations
  where request_id = r.id and status = 'disagreed';

  if disagreed_count > 0 then
    raise exception 'Cannot approve: % consulted department head(s) disagreed with this request', disagreed_count;
  end if;

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

-- 3. Enhance respond_head_consultation to support revising decisions and log revisions
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
  is_revision boolean;
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
  if r.status in ('approved', 'rejected', 'paid', 'withdrawn') then
    raise exception 'Cannot change consultation on an already finalized request (%)', r.status;
  end if;

  is_revision := (c.status <> 'pending');

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
    case when is_revision then 'Consultation Revised: ' else 'Consultation ' end || initcap(p_status::text) || ': ' || r.request_no,
    me.full_name || case when is_revision then ' REVISED decision to ' else ' ' end ||
      upper(p_status::text) || ' on request ' || r.request_no ||
      case when p_remarks is not null and btrim(p_remarks) <> '' then ': "' || p_remarks || '"' else '.' end
  );

  -- Log to workflow audit trail
  perform public._log_action(
    r.id,
    me,
    case
      when is_revision then 'consultation_revised'
      when p_status = 'agreed' then 'consultation_agreed'
      else 'consultation_disagreed'
    end,
    r.status,
    r.status,
    me.full_name || ' (' || coalesce(c.department_name, 'Head') || ') ' ||
      case when is_revision then 'REVISED decision to ' else '' end || upper(p_status::text) ||
      case when p_remarks is not null and btrim(p_remarks) <> '' then ' — Remarks: "' || p_remarks || '"' else '' end,
    true
  );

  return jsonb_build_object('success', true, 'revised', is_revision);
end $$;

-- 4. Update request_head_consultations so re-requesting a head resets status to pending
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

  if r.status in ('draft', 'withdrawn') then
    raise exception 'Consultations cannot be requested on draft or withdrawn requests';
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
        status = 'pending',
        request_note = excluded.request_note,
        response_remarks = null,
        responded_at = null;

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
