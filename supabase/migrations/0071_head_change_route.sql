-- ============================================================================
-- 0071_head_change_route.sql
--
-- Allow the owning Department Head to change the approval route on requests
-- waiting for their action:
--   * Route B ('pending_head_approval') -> Route A ('pending_head_review'):
--     Moves the request from "To Approve (Route B)" into "To Review (Route A)"
--     so the Head can review and forward it to Admin ('pending_admin_approval').
--   * Route A ('pending_head_review') -> Route B ('pending_head_approval'):
--     Moves the request into "To Approve (Route B)" when policy allows direct
--     Head approval (not own/head request, not exhibition, selected quote if
--     asset, and within high_value_threshold for general/asset requests).
-- ============================================================================

drop function if exists public.head_change_route(uuid, public.approval_route, text);

create or replace function public.head_change_route(
  p_request_id uuid,
  p_new_route public.approval_route,
  p_remarks text default null
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  me public.profiles;
  r public.requests;
  v_threshold numeric;
  v_next_status public.request_status;
  v_action text;
  v_remarks text;
begin
  me := public._me();
  if me.role is distinct from 'head' then
    raise exception 'Only a Department Head can change the approval route';
  end if;
  if p_new_route is null then
    raise exception 'Target route is required';
  end if;

  select * into r from public.requests where id = p_request_id for update;
  if r.id is null or not (r.department_id = me.department_id or r.owner_head_id = me.id) then
    raise exception 'Not found';
  end if;
  if r.requester_id = me.id then
    raise exception 'You cannot change the route of your own request';
  end if;
  if exists (
    select 1 from public.head_consultations
    where request_id = r.id and head_id = me.id
  ) then
    raise exception 'Consulted heads cannot change the route of another department request';
  end if;
  if r.status not in ('pending_head_approval', 'pending_head_review') then
    raise exception 'Route can only be changed while the request is waiting for Department Head action';
  end if;

  if p_new_route = 'A' then
    if r.status = 'pending_head_review' and r.route = 'A' then
      raise exception 'This request is already in To Review (Route A)';
    end if;

    v_next_status := 'pending_head_review';
    v_action := 'route_changed_A';
    v_remarks := coalesce(
      nullif(btrim(p_remarks), ''),
      'Changed route to Route A — moved to To Review for forwarding to Admin.'
    );

    update public.requests set
      route = 'A'::public.approval_route,
      status = v_next_status,
      updated_at = now()
    where id = r.id;

    perform public._log_action(r.id, me, v_action, r.status, v_next_status, v_remarks, true);

    delete from public.notifications
    where request_id = r.id
      and title = 'Request waiting for your approval'
      and read_at is null;

    perform public.notify_next_actor(r.id, v_next_status);
  else
    if r.status = 'pending_head_approval' and r.route = 'B' then
      raise exception 'This request is already in To Approve (Route B)';
    end if;
    if (r.request_type = 'asset' or r.request_type = 'asset_below_20k') and r.selected_quote_id is null then
      raise exception 'Select the best quotation before changing to Route B';
    end if;
    if r.requester_role = 'head' then
      raise exception 'A Department Head request must stay on Route A (Admin approval required)';
    end if;
    if r.request_type = 'exhibition' then
      raise exception 'Exhibition requests require Administrator approval and must stay on Route A';
    end if;

    select value::numeric into v_threshold
    from public.app_settings
    where key = 'high_value_threshold';
    v_threshold := coalesce(v_threshold, 10000);

    if r.request_type not in ('discount', 'stock_transfer', 'non_cash') and r.amount > v_threshold then
      raise exception 'Requests above % must stay on Route A (Admin approval required)', v_threshold;
    end if;

    v_next_status := 'pending_head_approval';
    v_action := 'route_changed_B';
    v_remarks := coalesce(
      nullif(btrim(p_remarks), ''),
      'Changed route to Route B — moved to To Approve for direct Head approval.'
    );

    update public.requests set
      route = 'B'::public.approval_route,
      status = v_next_status,
      updated_at = now()
    where id = r.id;

    perform public._log_action(r.id, me, v_action, r.status, v_next_status, v_remarks, true);

    delete from public.notifications
    where request_id = r.id
      and title = 'Request waiting for your review'
      and read_at is null;

    perform public.notify_next_actor(r.id, v_next_status);
  end if;

  return jsonb_build_object(
    'success', true,
    'status', v_next_status,
    'route', p_new_route
  );
end $$;

revoke execute on function public.head_change_route(uuid, public.approval_route, text) from public, anon;
grant execute on function public.head_change_route(uuid, public.approval_route, text) to authenticated;

-- Update forward_request so owning head check supports owner_head_id and allows
-- forwarding escalated asset requests once a quotation has already been selected.
create or replace function public.forward_request(p_request_id uuid, p_remarks text default null)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  me public.profiles;
  r public.requests;
  pending_count int;
  disagreed_count int;
  v_mand_ok boolean;
  v_mand_name text;
begin
  me := public._me();
  if me.role is distinct from 'head' then
    raise exception 'Only a head can forward';
  end if;

  select * into r from public.requests where id = p_request_id for update;
  if r.id is null or not (r.department_id = me.department_id or r.owner_head_id = me.id) then
    raise exception 'Not found';
  end if;
  if r.status <> 'pending_head_review' then
    raise exception 'Not waiting for head review';
  end if;
  if r.requester_id = me.id then
    raise exception 'You cannot review your own request';
  end if;
  if exists (
    select 1 from public.head_consultations
    where request_id = r.id and head_id = me.id
  ) then
    raise exception 'Consulted heads cannot forward requests of another department';
  end if;
  if (r.request_type = 'asset' or r.request_type = 'asset_below_20k') and r.selected_quote_id is null then
    raise exception 'Select the best quotation before forwarding to Admin';
  end if;

  -- Mandatory Head Consultation Check:
  if me.mandatory_head_consultation and me.mandatory_consultation_head_id is not null then
    select exists (
      select 1 from public.head_consultations
      where request_id = r.id
        and head_id = me.mandatory_consultation_head_id
        and status = 'agreed'
    ) into v_mand_ok;

    if not v_mand_ok then
      select full_name into v_mand_name from public.profiles where id = me.mandatory_consultation_head_id;
      raise exception 'Mandatory consultation with % is required and must be agreed before forwarding this request',
        coalesce(v_mand_name, 'the designated Department Head');
    end if;
  end if;

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
    route = 'A'::public.approval_route,
    reviewed_by = me.id,
    reviewed_by_name = me.full_name,
    reviewed_at = now(),
    updated_at = now()
  where id = r.id;

  perform public._log_action(r.id, me, 'forwarded', r.status, 'pending_admin_approval', p_remarks, true);

  delete from public.notifications
  where request_id = r.id
    and title = 'Request waiting for your review'
    and read_at is null;

  perform public.notify_next_actor(r.id, 'pending_admin_approval');
end $$;

revoke execute on function public.forward_request(uuid, text) from public, anon;
grant execute on function public.forward_request(uuid, text) to authenticated;

notify pgrst, 'reload schema';

