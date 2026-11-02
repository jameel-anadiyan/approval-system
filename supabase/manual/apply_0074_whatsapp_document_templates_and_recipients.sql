-- ============================================================================
-- apply_0074_whatsapp_document_templates_and_recipients.sql
-- Run in Supabase SQL Editor so Disbursement Payment accounts and Heads across
-- departments can resolve staff WhatsApp numbers and log document deliveries.
-- ============================================================================

-- 1. Security-definer recipient lookup for WhatsApp approval & payment alerts
create or replace function public.get_request_whatsapp_recipients(p_request_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  me public.profiles;
  r public.requests;
  v_req_prof public.profiles;
  v_head_prof public.profiles;
  v_def_head_prof public.profiles;
begin
  select * into me from public.profiles where id = auth.uid() and is_active;
  if me.id is null then
    raise exception 'Not authenticated';
  end if;

  select * into r from public.requests where id = p_request_id;
  if r.id is null then
    return '{}'::jsonb;
  end if;

  if not (
    public.can_view_request(r.id)
    or me.role = 'admin'
    or (me.role = 'disbursement' and r.status in ('approved', 'paid', 'cancelled'))
  ) then
    raise exception 'Not authorized to inspect recipients for this request';
  end if;

  if r.requester_id is not null then
    select * into v_req_prof from public.profiles where id = r.requester_id;
  end if;

  if r.owner_head_id is not null then
    select * into v_head_prof from public.profiles where id = r.owner_head_id;
  end if;

  if v_head_prof.whatsapp_number is null and v_req_prof.default_head_id is not null then
    select * into v_def_head_prof from public.profiles where id = v_req_prof.default_head_id;
  end if;

  return jsonb_build_object(
    'requester_id', r.requester_id,
    'requester_name', coalesce(v_req_prof.full_name, r.requester_name),
    'requester_phone', v_req_prof.whatsapp_number,
    'head_id', coalesce(v_head_prof.id, v_def_head_prof.id),
    'head_name', coalesce(v_head_prof.full_name, v_def_head_prof.full_name, r.owner_head_name),
    'head_phone', coalesce(v_head_prof.whatsapp_number, v_def_head_prof.whatsapp_number)
  );
end $$;

revoke execute on function public.get_request_whatsapp_recipients(uuid) from public, anon;
grant execute on function public.get_request_whatsapp_recipients(uuid) to authenticated;

-- 2. Allow authenticated roles (Head, Disbursement, Admin) to record WhatsApp delivery logs
grant insert on public.whatsapp_logs to authenticated;

drop policy if exists "whatsapp_logs insert policy" on public.whatsapp_logs;
create policy "whatsapp_logs insert policy" on public.whatsapp_logs
  for insert to authenticated
  with check ((select auth.uid()) is not null);

-- 3. Point default template_name to document-header template while preserving all saved tokens/numbers
update public.app_settings
set value = jsonb_set(
      coalesce(value, '{}'::jsonb),
      '{template_name}',
      '"approval_document_packet"'::jsonb,
      true
    ),
    updated_at = now()
where key = 'whatsapp_config'
  and coalesce(value ->> 'template_name', 'approval_notification') = 'approval_notification';

notify pgrst, 'reload schema';
