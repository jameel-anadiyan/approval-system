-- 0023_asset_admin_no_override.sql
-- Admin may select a quotation only when none was selected yet (Head's own request, or no active Head).
-- When the Head has selected (above the limit), Admin only approves / returns / rejects.

create or replace function public.select_quote(p_request_id uuid, p_file_id uuid, p_remarks text default null)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  me public.profiles; r public.requests; f public.request_files; threshold numeric;
  next_status public.request_status; v_route public.approval_route; n int;
begin
  me := public._me();
  select * into r from public.requests where id = p_request_id for update;
  if r.id is null or r.request_type <> 'asset' then raise exception 'Not found'; end if;
  select * into f from public.request_files where id = p_file_id and request_id = r.id;
  if f.id is null or f.quote_amount is null then raise exception 'That document is not a quotation on this request'; end if;

  if me.role = 'head' then
    if r.department_id <> me.department_id or r.requester_id = me.id then raise exception 'Not found'; end if;
    if r.status not in ('pending_head_review','pending_head_approval') then
      raise exception 'This request is not waiting for quote selection';
    end if;
    select count(*) into n from public.head_consultations where request_id = r.id and status in ('pending','disagreed');
    if n > 0 then raise exception 'Resolve the inter-department head consultations first'; end if;
  elsif me.role = 'admin' then
    if r.status <> 'pending_admin_approval' then raise exception 'This request is not waiting for Admin approval'; end if;
    if r.selected_quote_id is not null then
      raise exception 'The Head has already selected the quotation; Admin approves or returns it';
    end if;
  else
    raise exception 'Only the Head (or Admin) can select the quotation';
  end if;

  update public.request_files set quote_status = case when id = f.id then 'selected' else 'rejected' end
   where request_id = r.id and quote_amount is not null;

  next_status := r.status; v_route := r.route;
  if me.role = 'head' then
    select value::numeric into threshold from public.app_settings where key = 'high_value_threshold';
    threshold := coalesce(threshold, 10000);
    if f.quote_amount <= threshold then
      next_status := 'pending_head_approval'; v_route := 'B';
    else
      next_status := 'pending_admin_approval'; v_route := 'A';
    end if;
  end if;

  update public.requests set selected_quote_id = f.id, quote_selected_by = me.id, quote_selected_by_name = me.full_name,
    quote_selected_at = now(), amount = f.quote_amount, status = next_status, route = v_route,
    reviewed_by = case when next_status = 'pending_admin_approval' and me.role = 'head' then me.id else reviewed_by end,
    reviewed_by_name = case when next_status = 'pending_admin_approval' and me.role = 'head' then me.full_name else reviewed_by_name end,
    reviewed_at = case when next_status = 'pending_admin_approval' and me.role = 'head' then now() else reviewed_at end,
    updated_at = now()
  where id = r.id;

  perform public._log_action(r.id, me, 'quote_selected', r.status, next_status,
    'Selected ' || coalesce(f.quote_vendor, f.original_name) || ' · Rs. ' || to_char(f.quote_amount, 'FM999999999990.00')
      || case when next_status = 'pending_admin_approval' and r.status <> 'pending_admin_approval'
              then ' · above limit, sent to Admin' else '' end
      || coalesce(' · ' || nullif(btrim(p_remarks), ''), ''),
    true);
  if next_status <> r.status then perform public.notify_next_actor(r.id, next_status); end if;
  return jsonb_build_object('status', next_status, 'amount', f.quote_amount);
end $$;
revoke execute on function public.select_quote(uuid, uuid, text) from public, anon;
grant execute on function public.select_quote(uuid, uuid, text) to authenticated;

notify pgrst, 'reload schema';
