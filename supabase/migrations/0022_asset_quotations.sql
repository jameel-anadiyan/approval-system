-- 0022_asset_quotations.sql
-- Asset buying requests:
--   * Requester uploads at least 3 quotation documents and types the amount (and vendor) for each.
--     They may tag one quote as their preferred choice (visible to Head / Admin).
--   * Clerk sends the request to the Head for quote selection (no A/B choice for the clerk).
--   * Head selects the best quote. Selected amount <= threshold -> Head approves (Route B).
--     Above threshold -> goes to Admin for approval (Route A).
--   * On approval the selected quote is stamped APPROVED and the others are stamped REJECTED.
-- Requires 0021 ('asset' enum value) to be committed first.

-- Quotation data lives on the document row itself, so a quote and its file can never drift apart.
alter table public.request_files
  add column if not exists quote_vendor text check (quote_vendor is null or char_length(quote_vendor) <= 150),
  add column if not exists quote_amount numeric(14,2) check (quote_amount is null or quote_amount > 0),
  add column if not exists quote_preferred boolean not null default false,
  add column if not exists quote_status text check (quote_status is null or quote_status in ('pending','selected','rejected'));

alter table public.requests
  add column if not exists selected_quote_id uuid references public.request_files(id) on delete set null,
  add column if not exists quote_selected_by uuid references public.profiles(id),
  add column if not exists quote_selected_by_name text,
  add column if not exists quote_selected_at timestamptz;

-- Request amount for asset buying: selected quote, else requester's preferred, else the lowest quote.
create or replace function public._sync_asset_amount(p_request_id uuid)
returns void language plpgsql security definer set search_path = '' as $$
declare v numeric;
begin
  select coalesce(
    (select f.quote_amount from public.request_files f join public.requests r on r.selected_quote_id = f.id
      where r.id = p_request_id),
    (select max(quote_amount) from public.request_files
      where request_id = p_request_id and quote_amount is not null and quote_preferred),
    (select min(quote_amount) from public.request_files
      where request_id = p_request_id and quote_amount is not null))
  into v;
  if v is not null and v > 0 then
    update public.requests set amount = v, updated_at = now() where id = p_request_id and amount <> v;
  end if;
end $$;
revoke execute on function public._sync_asset_amount(uuid) from public, anon, authenticated;

-- _build_details: + asset ----------------------------------------------------------------------
create or replace function public._build_details(p_type public.request_type, p_amount numeric, p jsonb)
returns jsonb language plpgsql immutable set search_path = '' as $function$
declare
  d jsonb := coalesce(p, '{}'::jsonb);
  v_before numeric; v_after numeric; v_excl numeric; v_gst_pct numeric; v_gst numeric; v_total numeric;
  v_q1000 int; v_q500 int; v_other numeric; v_budget numeric; v_provides jsonb;
  v_has_gst boolean; v_base numeric; v_gen_gst numeric; v_gen_rate numeric;
begin
  if p_type = 'general' then
    if p_amount is null or p_amount <= 0 then raise exception 'Amount must be more than zero'; end if;
    v_has_gst := coalesce((d->>'has_gst')::boolean, false);
    v_base := public._num(d, 'base_amount');
    v_gen_gst := public._num(d, 'gst_amount');
    v_gen_rate := public._num(d, 'gst_rate');
    return jsonb_build_object(
      'amount', round(p_amount, 2),
      'details', jsonb_strip_nulls(jsonb_build_object(
        'base_amount', coalesce(v_base, round(p_amount, 2)),
        'has_gst', v_has_gst,
        'gst_rate', case when v_has_gst then coalesce(v_gen_rate, 18) else 0 end,
        'gst_amount', case when v_has_gst then coalesce(v_gen_gst, round(p_amount - coalesce(v_base, p_amount), 2)) else 0 end,
        'total_amount', round(p_amount, 2)
      ))
    );

  elsif p_type = 'discount' then
    v_before := public._num(d, 'before_amount');
    v_after := public._num(d, 'after_amount');
    if v_before is null or v_before <= 0 then raise exception 'Enter the amount before discount'; end if;
    if v_after is null or v_after < 0 then raise exception 'Enter the amount after discount'; end if;
    if v_after >= v_before then raise exception 'After-discount amount must be less than the amount before discount'; end if;
    return jsonb_build_object(
      'amount', v_before - v_after,
      'details', jsonb_build_object(
        'before_amount', v_before, 'after_amount', v_after,
        'discount_amount', v_before - v_after,
        'discount_pct', round((v_before - v_after) / v_before * 100, 2),
        'customer_name', public._txt(d, 'customer_name', 100),
        'reference', public._txt(d, 'reference', 100)));

  elsif p_type = 'asset' then
    if public._txt(d, 'asset_name') is null then raise exception 'Asset name is required'; end if;
    if p_amount is null or p_amount <= 0 then raise exception 'Enter the quotation amounts'; end if;
    return jsonb_build_object(
      'amount', round(p_amount, 2),
      'details', jsonb_strip_nulls(jsonb_build_object(
        'asset_name', public._txt(d, 'asset_name', 200),
        'quantity', public._txt(d, 'quantity', 50),
        'specification', public._txt(d, 'specification', 1000),
        'purpose', public._txt(d, 'purpose', 1000))));

  else -- exhibition
    if public._txt(d, 'event_name') is null then raise exception 'Event name is required'; end if;
    if public._txt(d, 'venue') is null then raise exception 'Venue is required'; end if;
    if public._txt(d, 'event_dates') is null then raise exception 'Event date(s) & time are required'; end if;
    v_excl := public._num(d, 'amount_excl_gst');
    if v_excl is null or v_excl <= 0 then raise exception 'Sponsorship amount (excl. GST) must be more than zero'; end if;
    v_gst_pct := coalesce(public._num(d, 'gst_pct'), 0);
    if v_gst_pct < 0 or v_gst_pct > 100 then raise exception 'GST %% must be between 0 and 100'; end if;
    v_gst := round(v_excl * v_gst_pct / 100, 2);
    v_total := v_excl + v_gst;
    v_q1000 := greatest(coalesce(public._num(d, 'voucher_1000_qty'), 0), 0)::int;
    v_q500 := greatest(coalesce(public._num(d, 'voucher_500_qty'), 0), 0)::int;
    v_other := greatest(coalesce(public._num(d, 'other_costs'), 0), 0);
    v_budget := coalesce(public._num(d, 'total_budget'), v_total + v_q1000 * 1000 + v_q500 * 500 + v_other);
    select coalesce(jsonb_agg(x), '[]'::jsonb) into v_provides
      from jsonb_array_elements_text(case when jsonb_typeof(d->'provides') = 'array' then d->'provides' else '[]'::jsonb end) x
      where x in ('stall_space','table_chairs','electricity_lights','logo_stage_banners','stage_announcements','social_media','other');
    return jsonb_build_object(
      'amount', v_total,
      'details', jsonb_build_object(
        'event_name', public._txt(d, 'event_name', 200),
        'organiser_contact', public._txt(d, 'organiser_contact'),
        'venue', public._txt(d, 'venue'),
        'event_dates', public._txt(d, 'event_dates'),
        'expected_footfall', public._txt(d, 'expected_footfall', 100),
        'stall_size_location', public._txt(d, 'stall_size_location'),
        'amount_excl_gst', v_excl, 'gst_pct', v_gst_pct, 'gst_amount', v_gst, 'total_incl_gst', v_total,
        'payment_mode_due', public._txt(d, 'payment_mode_due'),
        'organiser_gstin', upper(coalesce(public._txt(d, 'organiser_gstin', 20), '')),
        'gst_invoice', coalesce((d->>'gst_invoice')::boolean, false),
        'provides', v_provides,
        'provides_other', public._txt(d, 'provides_other', 200),
        'voucher_1000_qty', v_q1000, 'voucher_500_qty', v_q500,
        'voucher_1000_min', public._num(d, 'voucher_1000_min'),
        'voucher_500_min', public._num(d, 'voucher_500_min'),
        'other_costs', v_other, 'total_budget', v_budget,
        'terms', public._txt(d, 'terms')));
  end if;
end $function$;

-- Drafts: default title for asset ---------------------------------------------------------------
create or replace function public.create_typed_draft(p_type public.request_type, p_title text, p_amount numeric,
  p_notes text default null, p_details jsonb default null)
returns uuid language plpgsql security definer set search_path = '' as $function$
declare me public.profiles; v jsonb; v_id uuid; v_title text; v_shop text;
begin
  me := public._me();
  if me.role not in ('employee','clerk','head') then raise exception 'Your role cannot raise requests'; end if;
  if not (p_type = any(me.allowed_types)) then
    raise exception 'You are not allowed to raise % requests', p_type;
  end if;
  v := public._build_details(p_type, p_amount, p_details);
  v_title := nullif(btrim(coalesce(p_title, '')), '');
  if v_title is null and p_type = 'exhibition' then v_title := 'Exhibition: ' || (v->'details'->>'event_name'); end if;
  if v_title is null and p_type = 'asset' then v_title := 'Asset: ' || (v->'details'->>'asset_name'); end if;
  if v_title is null then raise exception 'Title is required'; end if;
  select name into v_shop from public.shops where id = me.shop_id;
  insert into public.requests (requester_id, requester_name, requester_role, department_id, title, notes, amount,
                               request_type, shop_id, shop_name, details)
  values (me.id, me.full_name, me.role, me.department_id, left(v_title, 200), nullif(btrim(p_notes), ''),
          (v->>'amount')::numeric, p_type, me.shop_id, v_shop, v->'details')
  returning id into v_id;
  return v_id;
end $function$;

create or replace function public.update_typed_draft(p_request_id uuid, p_title text, p_amount numeric,
  p_notes text default null, p_details jsonb default null)
returns void language plpgsql security definer set search_path = '' as $function$
declare me public.profiles; r public.requests; v jsonb; v_title text;
begin
  me := public._me();
  select * into r from public.requests where id = p_request_id for update;
  if r.id is null or r.requester_id <> me.id then raise exception 'Not found'; end if;
  if r.status not in ('draft','returned') then raise exception 'This request can no longer be edited'; end if;
  v := public._build_details(r.request_type, coalesce(p_amount, r.amount), coalesce(p_details, r.details));
  v_title := nullif(btrim(coalesce(p_title, '')), '');
  if v_title is null and r.request_type = 'exhibition' then v_title := 'Exhibition: ' || (v->'details'->>'event_name'); end if;
  if v_title is null and r.request_type = 'asset' then v_title := 'Asset: ' || (v->'details'->>'asset_name'); end if;
  if v_title is null then raise exception 'Title is required'; end if;
  update public.requests set title = left(v_title, 200), amount = (v->>'amount')::numeric,
    notes = nullif(btrim(p_notes), ''), details = v->'details', updated_at = now()
  where id = r.id;
  if r.request_type = 'asset' then perform public._sync_asset_amount(r.id); end if;
end $function$;

-- Requester sets vendor / amount / preferred on one of their quotation documents ----------------
create or replace function public.set_quote(p_file_id uuid, p_vendor text, p_amount numeric, p_preferred boolean default false)
returns void language plpgsql security definer set search_path = '' as $$
declare me public.profiles; f public.request_files; r public.requests;
begin
  me := public._me();
  select * into f from public.request_files where id = p_file_id;
  if f.id is null then raise exception 'Not found'; end if;
  select * into r from public.requests where id = f.request_id for update;
  if r.requester_id <> me.id then raise exception 'Not found'; end if;
  if r.status not in ('draft','returned') then raise exception 'This request can no longer be edited'; end if;
  if r.request_type <> 'asset' then raise exception 'Quotations are only for asset buying requests'; end if;
  if f.kind <> 'document' or f.added_by is not null then raise exception 'Only your own documents can be quotations'; end if;
  if nullif(btrim(coalesce(p_vendor, '')), '') is null then raise exception 'Enter the vendor name for each quotation'; end if;
  if p_amount is null or p_amount <= 0 then raise exception 'Enter the amount for each quotation'; end if;
  if coalesce(p_preferred, false) then
    update public.request_files set quote_preferred = false where request_id = r.id and id <> f.id;
  end if;
  update public.request_files set quote_vendor = left(btrim(p_vendor), 150), quote_amount = round(p_amount, 2),
    quote_preferred = coalesce(p_preferred, false), quote_status = 'pending'
  where id = f.id;
  perform public._sync_asset_amount(r.id);
end $$;
revoke execute on function public.set_quote(uuid, text, numeric, boolean) from public, anon;
grant execute on function public.set_quote(uuid, text, numeric, boolean) to authenticated;

-- remove_file: keep the asset amount in step -----------------------------------------------------
create or replace function public.remove_file(p_file_id uuid)
returns text language plpgsql security definer set search_path = '' as $function$
declare me public.profiles; f public.request_files; r public.requests;
begin
  me := public._me();
  select * into f from public.request_files where id = p_file_id;
  if f.id is null then raise exception 'Not found'; end if;
  select * into r from public.requests where id = f.request_id for update;
  if r.requester_id <> me.id then raise exception 'Not found'; end if;
  if r.status not in ('draft','returned') then raise exception 'This request can no longer be edited'; end if;
  if f.added_by is not null and f.added_by <> me.id then raise exception 'This voice note was added by an approver'; end if;
  delete from public.request_files where id = f.id;
  if r.request_type = 'asset' then perform public._sync_asset_amount(r.id); end if;
  return f.storage_path;
end $function$;

-- submit: asset needs >= 3 complete quotations; resubmission clears any earlier selection ------
create or replace function public.submit_request(p_request_id uuid)
returns void language plpgsql security definer set search_path = '' as $function$
declare me public.profiles; r public.requests; v_no text; n int;
begin
  me := public._me();
  select * into r from public.requests where id = p_request_id for update;
  if r.id is null or r.requester_id <> me.id then raise exception 'Not found'; end if;
  if r.status not in ('draft','returned') then raise exception 'This request has already been submitted'; end if;
  if r.amount <= 0 then raise exception 'Amount must be more than zero'; end if;
  if not (r.request_type = any(me.allowed_types)) then
    raise exception 'You are no longer allowed to raise % requests', r.request_type;
  end if;
  if r.request_type = 'general' and not exists (
       select 1 from public.request_files where request_id = r.id and kind = 'document') then
    raise exception 'Attach at least one document';
  end if;
  if r.request_type = 'discount' and not exists (
       select 1 from public.request_files
        where request_id = r.id and kind = 'document' and mime_type = 'application/pdf' and added_by is null) then
    raise exception 'Attach the discount PDF to submit';
  end if;
  if r.request_type = 'asset' then
    select count(*) into n from public.request_files
     where request_id = r.id and kind = 'document' and added_by is null
       and quote_amount is not null and nullif(btrim(coalesce(quote_vendor, '')), '') is not null;
    if n < 3 then raise exception 'Attach at least 3 quotations, each with vendor name and amount (% so far)', n; end if;
    update public.request_files set quote_status = 'pending' where request_id = r.id and quote_amount is not null;
    update public.requests set selected_quote_id = null, quote_selected_by = null, quote_selected_by_name = null,
      quote_selected_at = null where id = r.id;
    perform public._sync_asset_amount(r.id);
  end if;
  v_no := coalesce(r.request_no, public.next_number(
    coalesce((select value #>> '{}' from public.app_settings where key = 'request_prefix'), 'REQ')));
  update public.requests set status = 'submitted', request_no = v_no,
    route = null, routed_by = null, routed_at = null, reviewed_by = null, reviewed_by_name = null, reviewed_at = null,
    submitted_at = coalesce(submitted_at, now()), updated_at = now()
  where id = r.id;
  perform public._log_action(r.id, me, case when r.status = 'returned' then 'resubmitted' else 'submitted' end,
    r.status, 'submitted', null, true);
  perform public.notify_next_actor(r.id, 'submitted');
end $function$;

-- route: asset goes to Head for quote selection (or Admin when the requester is the Head) ------
create or replace function public.route_request(p_request_id uuid, p_route public.approval_route, p_remarks text default null)
returns void language plpgsql security definer set search_path = '' as $function$
declare
  me public.profiles; r public.requests; threshold numeric;
  next_status public.request_status; has_head boolean; v_route public.approval_route;
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

  if r.request_type = 'asset' then
    -- The Head's quote choice decides the level, so the clerk only forwards.
    if r.requester_role = 'head' or not has_head then
      next_status := 'pending_admin_approval'; v_route := 'A';
    else
      next_status := 'pending_head_review'; v_route := null;
    end if;
    update public.requests set status = next_status, route = v_route,
      routed_by = me.id, routed_at = now(), updated_at = now() where id = r.id;
    perform public._log_action(r.id, me, 'sent_for_quote_selection', r.status, next_status, p_remarks, true);
    perform public.notify_next_actor(r.id, next_status);
    return;
  end if;

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
end $function$;

-- forward: asset must use select_quote instead ---------------------------------------------------
create or replace function public.forward_request(p_request_id uuid, p_remarks text default null)
returns void language plpgsql security definer set search_path = '' as $function$
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
  if r.request_type = 'asset' then raise exception 'Select the best quotation; that decides Head or Admin approval'; end if;

  select count(*) into pending_count from public.head_consultations where request_id = r.id and status = 'pending';
  if pending_count > 0 then
    raise exception 'Cannot forward: Awaiting review response from % consulted department head(s)', pending_count;
  end if;
  select count(*) into disagreed_count from public.head_consultations where request_id = r.id and status = 'disagreed';
  if disagreed_count > 0 then
    raise exception 'Cannot forward: % consulted department head(s) disagreed with this request', disagreed_count;
  end if;

  update public.requests set status = 'pending_admin_approval', reviewed_by = me.id, reviewed_by_name = me.full_name,
    reviewed_at = now(), updated_at = now()
  where id = r.id;
  perform public._log_action(r.id, me, 'forwarded', r.status, 'pending_admin_approval', p_remarks, true);
  perform public.notify_next_actor(r.id, 'pending_admin_approval');
end $function$;

-- Head (or Admin when the request reached Admin directly) picks the best quotation --------------
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

-- begin_approval: asset needs a selected quote; files carry quote info for stamping -------------
create or replace function public.begin_approval(p_request_id uuid, p_approver_id uuid)
returns jsonb language plpgsql security definer set search_path = '' as $function$
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
  if r.request_type = 'asset' and r.selected_quote_id is null then
    raise exception 'Select the best quotation before approving';
  end if;

  select count(*) into pending_count from public.head_consultations where request_id = r.id and status = 'pending';
  if pending_count > 0 then
    raise exception 'Cannot approve: Awaiting review response from % consulted department head(s)', pending_count;
  end if;
  select count(*) into disagreed_count from public.head_consultations where request_id = r.id and status = 'disagreed';
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
       'request_type', r.request_type, 'details', r.details, 'shop_name', r.shop_name,
       'quote_selected_by_name', r.quote_selected_by_name, 'quote_selected_at', r.quote_selected_at),
    'approval_no', v_no, 'decided_at', v_now,
    'approver', jsonb_build_object('id', me.id, 'full_name', me.full_name, 'designation', me.designation,
       'role', me.role, 'department', (select name from public.departments where id = me.department_id)),
    'seal_path', c.seal_path, 'signature_path', c.signature_path,
    'files', coalesce((select jsonb_agg(jsonb_build_object('id', f.id, 'storage_path', f.storage_path,
       'original_name', f.original_name, 'mime_type', f.mime_type,
       'quote_vendor', f.quote_vendor, 'quote_amount', f.quote_amount, 'quote_preferred', f.quote_preferred,
       'quote_status', f.quote_status) order by f.sort_order, f.created_at)
       from public.request_files f where f.request_id = r.id and f.kind = 'document'), '[]'::jsonb),
    'timeline', coalesce((select jsonb_agg(jsonb_build_object('actor_name', a.actor_name, 'actor_role', a.actor_role,
       'action', a.action, 'remarks', a.remarks, 'created_at', a.created_at) order by a.created_at)
       from public.request_actions a where a.request_id = r.id), '[]'::jsonb));
end $function$;

notify pgrst, 'reload schema';
