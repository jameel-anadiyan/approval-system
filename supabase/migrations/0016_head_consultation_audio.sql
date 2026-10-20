-- 0016_head_consultation_audio.sql
-- Adds audio recording support to inter-department head consultations.
-- Heads can attach a voice note when requesting consultation or when responding.

-- 1. Add voice storage columns to head_consultations
alter table public.head_consultations
  add column if not exists request_voice_path text,
  add column if not exists request_voice_duration numeric,
  add column if not exists response_voice_path text,
  add column if not exists response_voice_duration numeric;

-- 2. Update can_add_action_voice to allow consulted heads to upload voice responses
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
      or (me.role = 'head' and exists (
            select 1 from public.head_consultations hc
            where hc.request_id = r.id and hc.head_id = me.id
          ))
    )
  )
$$;

revoke execute on function public.can_add_action_voice(uuid) from public, anon;
grant execute on function public.can_add_action_voice(uuid) to authenticated;

-- 3. Drop old signatures to avoid overload ambiguity
drop function if exists public.request_head_consultations(uuid, uuid[], text);
drop function if exists public.respond_head_consultation(uuid, public.head_consultation_status, text);

-- 4. Update request_head_consultations to accept voice note path and duration
create or replace function public.request_head_consultations(
  p_request_id uuid,
  p_head_ids uuid[],
  p_note text default null,
  p_voice_path text default null,
  p_voice_duration numeric default null
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
        status, request_note, request_voice_path, request_voice_duration
      ) values (
        r.id, me.id, me.full_name,
        target_head.id, target_head.full_name, target_dept.id, target_dept.name,
        'pending', p_note, p_voice_path, p_voice_duration
      )
      on conflict (request_id, head_id) do update set
        status = 'pending',
        request_note = excluded.request_note,
        request_voice_path = coalesce(excluded.request_voice_path, head_consultations.request_voice_path),
        request_voice_duration = coalesce(excluded.request_voice_duration, head_consultations.request_voice_duration),
        response_remarks = null,
        response_voice_path = null,
        response_voice_duration = null,
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
          case when p_note is not null and btrim(p_note) <> '' then ': "' || p_note || '"' else '.' end ||
          case when p_voice_path is not null then ' (Voice note attached)' else '' end
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
        case when p_note is not null and btrim(p_note) <> '' then ' — Note: "' || p_note || '"' else '' end ||
        case when p_voice_path is not null then ' (Includes Voice Note)' else '' end,
      true
    );
  end if;

  return jsonb_build_object('success', true, 'count', inserted_count);
end $$;

revoke execute on function public.request_head_consultations(uuid, uuid[], text, text, numeric) from public, anon;
grant execute on function public.request_head_consultations(uuid, uuid[], text, text, numeric) to authenticated;

-- 5. Update respond_head_consultation to accept response voice note
create or replace function public.respond_head_consultation(
  p_consultation_id uuid,
  p_status public.head_consultation_status,
  p_remarks text default null,
  p_voice_path text default null,
  p_voice_duration numeric default null
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

  select * into r from public.requests where id = c.request_id for update;
  if r.id is null then
    raise exception 'Associated request not found';
  end if;

  if r.status in ('approved', 'rejected', 'paid', 'withdrawn') then
    raise exception 'Cannot respond: Request is already %', r.status;
  end if;

  is_revision := (c.status <> 'pending');

  update public.head_consultations
  set status = p_status,
      response_remarks = p_remarks,
      response_voice_path = coalesce(p_voice_path, response_voice_path),
      response_voice_duration = coalesce(p_voice_duration, response_voice_duration),
      responded_at = now()
  where id = c.id;

  -- Notify the original requesting head
  insert into public.notifications (user_id, request_id, title, body)
  values (
    c.requested_by,
    r.id,
    'Consultation ' || case when is_revision then 'Revised: ' else 'Response: ' end || r.request_no,
    me.full_name || ' (' || coalesce(c.department_name, 'Head') || ') ' ||
      case when is_revision then 'revised their decision to: ' else 'responded: ' end ||
      upper(p_status::text) ||
      case when p_remarks is not null and btrim(p_remarks) <> '' then ' — "' || p_remarks || '"' else '.' end ||
      case when p_voice_path is not null then ' (Voice note attached)' else '' end
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
      case when p_remarks is not null and btrim(p_remarks) <> '' then ' — Remarks: "' || p_remarks || '"' else '' end ||
      case when p_voice_path is not null then ' (Includes Voice Note)' else '' end,
    true
  );

  return jsonb_build_object('success', true, 'revised', is_revision);
end $$;

revoke execute on function public.respond_head_consultation(uuid, public.head_consultation_status, text, text, numeric) from public, anon;
grant execute on function public.respond_head_consultation(uuid, public.head_consultation_status, text, text, numeric) to authenticated;
