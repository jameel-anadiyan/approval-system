-- Migration 0048: Stock Transfer request type and Product Category Master
-- 1. Product Categories table and management RPC
-- 2. Update profiles allowed_types
-- 3. Update _build_details, create_typed_draft, update_typed_draft
-- 4. Update submit_request, route_request
-- 5. Update RLS policies and can_view_request to exclude stock_transfer from disbursement

-- ───────────────────────── 1. Product Categories Master ───────────────────────

create table if not exists public.product_categories (
  id uuid primary key default gen_random_uuid(),
  name text not null check (char_length(btrim(name)) between 1 and 100),
  is_active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create unique index if not exists product_categories_name_key
  on public.product_categories (lower(btrim(name)));

alter table public.product_categories enable row level security;

revoke all on public.product_categories from anon;
grant select on public.product_categories to authenticated;
grant all on public.product_categories to service_role;

drop policy if exists product_categories_select on public.product_categories;
create policy product_categories_select on public.product_categories for select
  using ((select public.my_role()) is not null);

drop policy if exists product_categories_admin_all on public.product_categories;
create policy product_categories_admin_all on public.product_categories for all
  using ((select public.my_role()) = 'admin'::public.app_role)
  with check ((select public.my_role()) = 'admin'::public.app_role);

-- Seed initial product categories
insert into public.product_categories (name)
values
  ('Diamond Rings'),
  ('Gold Necklaces'),
  ('Earrings'),
  ('Bracelets & Bangles'),
  ('Pendants'),
  ('Chains'),
  ('Diamond Studs'),
  ('Coins & Bars')
on conflict do nothing;

create or replace function public.save_product_category(
  p_id uuid,
  p_name text,
  p_is_active boolean default true
)
returns uuid language plpgsql security definer set search_path = '' as $$
declare
  me public.profiles;
  v_id uuid;
begin
  me := public._me();
  if me.role is distinct from 'admin' then
    raise exception 'Only Admin can manage product categories';
  end if;

  if p_name is null or char_length(btrim(p_name)) = 0 then
    raise exception 'Category name is required';
  end if;

  if p_id is null then
    insert into public.product_categories (name, is_active)
    values (btrim(p_name), coalesce(p_is_active, true))
    returning id into v_id;
  else
    update public.product_categories
    set name = btrim(p_name),
        is_active = coalesce(p_is_active, true),
        updated_at = now()
    where id = p_id
    returning id into v_id;

    if v_id is null then
      raise exception 'Category not found';
    end if;
  end if;

  insert into public.audit_log (actor_id, actor_name, action, target_type, target_id, details)
  values (
    me.id,
    me.full_name,
    case when p_id is null then 'product_category_created' else 'product_category_updated' end,
    'product_category',
    v_id::text,
    jsonb_build_object('name', btrim(p_name), 'is_active', coalesce(p_is_active, true))
  );

  return v_id;
end $$;

grant execute on function public.save_product_category(uuid, text, boolean) to authenticated;

-- ───────────────────────── 2. Update allowed_types ────────────────────────────

update public.profiles
set allowed_types = array_append(allowed_types, 'stock_transfer'::public.request_type)
where allowed_types is not null
  and not ('stock_transfer'::public.request_type = any(allowed_types));

alter table public.profiles
  alter column allowed_types set default array[
    'general'::public.request_type,
    'discount'::public.request_type,
    'exhibition'::public.request_type,
    'asset'::public.request_type,
    'asset_below_20k'::public.request_type,
    'non_cash'::public.request_type,
    'stock_transfer'::public.request_type
  ];

-- ───────────────────────── 3. Update _build_details ───────────────────────────

create or replace function public._build_details(p_type public.request_type, p_amount numeric, p jsonb)
returns jsonb language plpgsql immutable set search_path = '' as $function$
declare
  d jsonb := coalesce(p, '{}'::jsonb);
  v_before numeric; v_after numeric; v_excl numeric; v_gst_pct numeric; v_gst numeric; v_total numeric;
  v_has_gst boolean; v_base numeric; v_gen_gst numeric; v_gen_rate numeric;
  -- Stock transfer variables
  v_mode text;
  v_items jsonb;
  v_item jsonb;
  v_pieces int := 0;
  v_gross_wt numeric := 0;
  v_mrp_total numeric := 0;
  v_from_shop text;
  v_to_shop text;
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

  elsif p_type = 'asset' or p_type = 'asset_below_20k' then
    if public._txt(d, 'asset_name') is null then raise exception 'Asset name is required'; end if;
    if p_amount is null or p_amount <= 0 then raise exception 'Enter the quotation amounts'; end if;
    if p_type = 'asset_below_20k' and p_amount > 20000 then
      raise exception 'Amount cannot exceed ₹20,000 for Asset Buying Below 20k';
    end if;
    return jsonb_build_object(
      'amount', round(p_amount, 2),
      'details', jsonb_strip_nulls(jsonb_build_object(
        'asset_name', public._txt(d, 'asset_name', 200),
        'quantity', public._txt(d, 'quantity', 50),
        'specification', public._txt(d, 'specification', 1000),
        'purpose', public._txt(d, 'purpose', 1000))));

  elsif p_type = 'stock_transfer' then
    v_from_shop := public._txt(d, 'from_shop_name', 150);
    v_to_shop := public._txt(d, 'to_shop_name', 150);
    if public._txt(d, 'from_shop_id') is null then raise exception 'Source (From) shop is required'; end if;
    if public._txt(d, 'to_shop_id') is null then raise exception 'Destination (To) shop is required'; end if;
    if (d->>'from_shop_id') = (d->>'to_shop_id') then
      raise exception 'Destination shop cannot be the same as source shop';
    end if;

    v_mode := coalesce(d->>'transfer_mode', 'itemized');
    if v_mode = 'bulk' then
      v_pieces := coalesce((d->>'pieces_count')::int, 0);
      v_gross_wt := coalesce(public._num(d, 'total_gross_weight'), 0);
      v_mrp_total := coalesce(public._num(d, 'total_mrp'), 0);
      if v_pieces <= 0 then raise exception 'Number of pieces must be at least 1'; end if;
      if v_gross_wt <= 0 then raise exception 'Total gross weight must be greater than zero'; end if;
      if v_mrp_total <= 0 then raise exception 'Total MRP must be greater than zero'; end if;

      return jsonb_build_object(
        'amount', round(v_mrp_total, 2),
        'details', jsonb_strip_nulls(jsonb_build_object(
          'transfer_mode', 'bulk',
          'from_shop_id', d->>'from_shop_id',
          'from_shop_name', v_from_shop,
          'to_shop_id', d->>'to_shop_id',
          'to_shop_name', v_to_shop,
          'category_id', d->>'category_id',
          'category_name', public._txt(d, 'category_name', 100),
          'pieces_count', v_pieces,
          'total_pieces', v_pieces,
          'total_gross_weight', round(v_gross_wt, 3),
          'total_mrp', round(v_mrp_total, 2),
          'notes', public._txt(d, 'notes', 2000)
        ))
      );
    else
      -- Itemized transfer
      v_items := coalesce(d->'items', '[]'::jsonb);
      if jsonb_array_length(v_items) = 0 then
        raise exception 'Add at least one product to transfer';
      end if;

      for v_item in select * from jsonb_array_elements(v_items)
      loop
        v_pieces := v_pieces + 1;
        v_gross_wt := v_gross_wt + coalesce((v_item->>'gross_weight')::numeric, 0);
        v_mrp_total := v_mrp_total + coalesce((v_item->>'mrp')::numeric, 0);
      end loop;

      return jsonb_build_object(
        'amount', round(v_mrp_total, 2),
        'details', jsonb_strip_nulls(jsonb_build_object(
          'transfer_mode', 'itemized',
          'from_shop_id', d->>'from_shop_id',
          'from_shop_name', v_from_shop,
          'to_shop_id', d->>'to_shop_id',
          'to_shop_name', v_to_shop,
          'items', v_items,
          'pieces_count', v_pieces,
          'total_pieces', v_pieces,
          'total_gross_weight', round(v_gross_wt, 3),
          'total_mrp', round(v_mrp_total, 2),
          'notes', public._txt(d, 'notes', 2000)
        ))
      );
    end if;

  else -- exhibition
    if public._txt(d, 'event_name') is null then raise exception 'Event name is required'; end if;
    if public._txt(d, 'venue') is null then raise exception 'Venue is required'; end if;
    if public._txt(d, 'event_dates') is null then raise exception 'Event date(s) & time are required'; end if;
    v_excl := public._num(d, 'amount_excl_gst');
    if v_excl is null or v_excl <= 0 then raise exception 'Sponsorship amount (excl. GST) must be more than zero'; end if;
    v_has_gst := coalesce((d->>'has_gst')::boolean, true);
    v_gst_pct := coalesce(public._num(d, 'gst_pct'), 18);
    v_gst := case when v_has_gst then round(v_excl * (v_gst_pct / 100), 2) else 0 end;
    v_total := v_excl + v_gst;
    return jsonb_build_object(
      'amount', v_total,
      'details', jsonb_strip_nulls(jsonb_build_object(
        'event_name', public._txt(d, 'event_name', 150),
        'venue', public._txt(d, 'venue', 200),
        'event_dates', public._txt(d, 'event_dates', 200),
        'event_start', public._txt(d, 'event_start', 30),
        'event_end', public._txt(d, 'event_end', 30),
        'amount_excl_gst', v_excl,
        'has_gst', v_has_gst,
        'gst_pct', v_gst_pct,
        'gst_amount', v_gst,
        'total_amount', v_total,
        'payment_mode_due', public._txt(d, 'payment_mode_due', 100),
        'organiser_contact', public._txt(d, 'organiser_contact', 150),
        'organiser_gstin', public._txt(d, 'organiser_gstin', 30),
        'gst_invoice', coalesce((d->>'gst_invoice')::boolean, false),
        'expected_footfall', public._txt(d, 'expected_footfall', 50),
        'stall_size_location', public._txt(d, 'stall_size_location', 100),
        'provides', d->'provides',
        'provides_other', public._txt(d, 'provides_other', 200),
        'voucher_1000_qty', public._num(d, 'voucher_1000_qty'),
        'voucher_500_qty', public._num(d, 'voucher_500_qty'),
        'voucher_1000_min', public._num(d, 'voucher_1000_min'),
        'voucher_500_min', public._num(d, 'voucher_500_min'),
        'voucher_validity', public._txt(d, 'voucher_validity', 50),
        'lucky_draw', public._txt(d, 'lucky_draw', 150),
        'winners_draw', public._txt(d, 'winners_draw', 100),
        'other_costs', public._num(d, 'other_costs'),
        'total_budget', coalesce(public._num(d, 'total_budget'), v_total),
        'purpose', public._txt(d, 'purpose', 1000),
        'is_waitlist', coalesce((d->>'is_waitlist')::boolean, false)
      ))
    );
  end if;
end $function$;

-- ───────────────────────── 4. Update create_typed_draft ───────────────────────

create or replace function public.create_typed_draft(
  p_type public.request_type,
  p_title text,
  p_amount numeric,
  p_notes text default null::text,
  p_details jsonb default null::jsonb,
  p_target_head_id uuid default null::uuid
)
returns uuid language plpgsql security definer set search_path to '' as $function$
declare
  me public.profiles;
  v jsonb;
  v_id uuid;
  v_title text;
  v_shop text;
  v_shop_id uuid;
  v_amount numeric;
  v_target_head public.profiles;
  v_dept_id uuid;
  v_owner_head_id uuid;
  v_owner_head_name text;
  v_region_id uuid;
  v_region_name text;
  v_is_waitlist boolean;
begin
  me := public._me();
  if me.role not in ('employee','clerk','head','regional_head') then
    raise exception 'Your role cannot raise requests';
  end if;
  if not (p_type = any(me.allowed_types) or (p_type = 'asset_below_20k' and 'asset'::public.request_type = any(me.allowed_types)) or me.role in ('admin', 'head')) then
    raise exception 'You are not allowed to raise % requests', p_type;
  end if;

  if p_type = 'non_cash' then
    v_amount := 0;
  else
    v := public._build_details(p_type, p_amount, p_details);
    v_amount := (v->>'amount')::numeric;
  end if;

  if p_type = 'asset_below_20k' and v_amount > 20000 then
    raise exception 'Amount cannot exceed ₹20,000 for Asset Buying Below 20k';
  end if;

  v_title := nullif(btrim(coalesce(p_title, '')), '');
  if v_title is null and p_type = 'exhibition' then v_title := 'Exhibition: ' || (v->'details'->>'event_name'); end if;
  if v_title is null and (p_type = 'asset' or p_type = 'asset_below_20k') then v_title := 'Asset: ' || (v->'details'->>'asset_name'); end if;
  if v_title is null and p_type = 'non_cash' then v_title := 'Non-Cash Request'; end if;
  if v_title is null and p_type = 'stock_transfer' then
    v_title := 'Stock Transfer: ' || coalesce(v->'details'->>'from_shop_name', 'Shop') || ' → ' || coalesce(v->'details'->>'to_shop_name', 'Shop');
  end if;
  if v_title is null then raise exception 'Title is required'; end if;

  -- Routing rules:
  -- For exhibition requests: STRICTLY to Main Head only, NO choosing.
  if p_type = 'exhibition' then
    if me.default_head_id is not null then
      select * into v_target_head from public.profiles
      where id = me.default_head_id and role = 'head' and is_active;
    end if;
    if v_target_head.id is null and me.department_id is not null then
      select * into v_target_head from public.profiles
      where department_id = me.department_id and role = 'head' and is_active limit 1;
    end if;
    if v_target_head.id is not null then
      v_dept_id := v_target_head.department_id;
      v_owner_head_id := v_target_head.id;
      v_owner_head_name := v_target_head.full_name;
    else
      v_dept_id := me.department_id;
    end if;
  elsif p_target_head_id is not null then
    select * into v_target_head from public.profiles
    where id = p_target_head_id and role = 'head' and is_active;
    if v_target_head.id is null then raise exception 'The selected Head is not active or not found'; end if;
    v_dept_id := v_target_head.department_id;
    v_owner_head_id := v_target_head.id;
    v_owner_head_name := v_target_head.full_name;
  elsif me.default_head_id is not null then
    select * into v_target_head from public.profiles
    where id = me.default_head_id and role = 'head' and is_active;
    if v_target_head.id is not null then
      v_dept_id := v_target_head.department_id;
      v_owner_head_id := v_target_head.id;
      v_owner_head_name := v_target_head.full_name;
    else
      v_dept_id := me.department_id;
    end if;
  else
    v_dept_id := me.department_id;
  end if;

  -- Shop assignment
  v_shop_id := me.shop_id;
  select name into v_shop from public.shops where id = v_shop_id;

  if p_type = 'stock_transfer' and (v->'details'->>'from_shop_id') ~ '^[0-9a-fA-F-]{36}$' then
    v_shop_id := (v->'details'->>'from_shop_id')::uuid;
    v_shop := coalesce(v->'details'->>'from_shop_name', (select name from public.shops where id = v_shop_id));
  end if;

  v_region_id := null;
  v_region_name := null;
  v_is_waitlist := false;
  if p_type = 'exhibition' then
    v_region_id := coalesce(
      me.region_id,
      (select p.region_id from public.profiles p where p.id = me.regional_head_id),
      case when p_details ? 'region_id' and p_details->>'region_id' ~ '^[0-9a-fA-F-]{36}$'
           then (p_details->>'region_id')::uuid else null end
    );
    if v_region_id is not null then
      select name into v_region_name from public.regions where id = v_region_id;
    end if;
    v_is_waitlist := coalesce((p_details->>'is_waitlist')::boolean, false);
  end if;

  insert into public.requests (
    requester_id, requester_name, requester_role, department_id, title, notes, amount,
    request_type, shop_id, shop_name, details, owner_head_id, owner_head_name,
    region_id, region_name, is_waitlist
  )
  values (
    me.id, me.full_name, me.role, v_dept_id, left(v_title, 200), nullif(btrim(p_notes), ''),
    v_amount, p_type, v_shop_id, v_shop, case when p_type = 'non_cash' then p_details else v->'details' end,
    v_owner_head_id, v_owner_head_name,
    v_region_id, v_region_name, v_is_waitlist
  )
  returning id into v_id;
  return v_id;
end $function$;

-- ───────────────────────── 5. Update update_typed_draft ───────────────────────

create or replace function public.update_typed_draft(
  p_request_id uuid,
  p_title text,
  p_amount numeric,
  p_notes text default null::text,
  p_details jsonb default null::jsonb
)
returns void language plpgsql security definer set search_path = '' as $function$
declare
  me public.profiles;
  r public.requests;
  v jsonb;
  v_title text;
  v_shop_id uuid;
  v_shop_name text;
begin
  me := public._me();
  select * into r from public.requests where id = p_request_id for update;
  if r.id is null or r.requester_id <> me.id then raise exception 'Not found'; end if;
  if r.status not in ('draft','returned') then raise exception 'This request can no longer be edited'; end if;
  v := public._build_details(r.request_type, coalesce(p_amount, r.amount), coalesce(p_details, r.details));
  v_title := nullif(btrim(coalesce(p_title, '')), '');
  if v_title is null and r.request_type = 'exhibition' then v_title := 'Exhibition: ' || (v->'details'->>'event_name'); end if;
  if v_title is null and (r.request_type = 'asset' or r.request_type = 'asset_below_20k') then v_title := 'Asset: ' || (v->'details'->>'asset_name'); end if;
  if v_title is null and r.request_type = 'non_cash' then v_title := 'Non-Cash Request'; end if;
  if v_title is null and r.request_type = 'stock_transfer' then
    v_title := 'Stock Transfer: ' || coalesce(v->'details'->>'from_shop_name', 'Shop') || ' → ' || coalesce(v->'details'->>'to_shop_name', 'Shop');
  end if;
  if v_title is null then raise exception 'Title is required'; end if;

  v_shop_id := r.shop_id;
  v_shop_name := r.shop_name;
  if r.request_type = 'stock_transfer' and (v->'details'->>'from_shop_id') ~ '^[0-9a-fA-F-]{36}$' then
    v_shop_id := (v->'details'->>'from_shop_id')::uuid;
    v_shop_name := coalesce(v->'details'->>'from_shop_name', (select name from public.shops where id = v_shop_id));
  end if;

  update public.requests set
    title = left(v_title, 200),
    amount = case when r.request_type = 'non_cash' then 0 else (v->>'amount')::numeric end,
    notes = nullif(btrim(p_notes), ''),
    details = case when r.request_type = 'non_cash' then coalesce(p_details, r.details) else v->'details' end,
    shop_id = v_shop_id,
    shop_name = v_shop_name,
    updated_at = now()
  where id = r.id;
  if r.request_type = 'asset' or r.request_type = 'asset_below_20k' then
    perform public._sync_asset_amount(r.id);
  end if;
end $function$;

-- ───────────────────────── 6. Update submit_request ───────────────────────────

create or replace function public.submit_request(p_request_id uuid)
 returns void language plpgsql security definer set search_path to '' as $function$
declare
  me public.profiles; r public.requests; rh public.profiles; v_no text; n int; v_rh_count int;
  v_next public.request_status; v_cat_ok boolean;
begin
  me := public._me();
  select * into r from public.requests where id = p_request_id for update;
  if r.id is null or r.requester_id <> me.id then raise exception 'Not found'; end if;
  if r.status not in ('draft','returned') then raise exception 'This request cannot be submitted'; end if;

  -- Requester profile must be complete (shop required for employee unless stock transfer specifies it)
  if r.shop_id is null and me.shop_id is null and me.role = 'employee' then
    raise exception 'Your shop is not assigned yet. Contact your Department Head before submitting';
  end if;

  -- Title and amount sanity (non_cash and stock_transfer are exempt from monetary payment requirement)
  if r.request_type not in ('non_cash', 'stock_transfer') and (r.amount is null or r.amount <= 0) then
    raise exception 'Amount must be greater than zero';
  end if;

  if not (r.request_type = any(me.allowed_types) or (r.request_type = 'asset_below_20k' and 'asset'::public.request_type = any(me.allowed_types)) or me.role in ('admin', 'head')) then
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

  -- Work category (only needed when several clerks split the target department's work).
  -- Department Head requests bypass clerk routing completely.
  v_cat_ok := r.category_id is not null and exists (
    select 1 from public.work_categories c
     where c.id = r.category_id and c.department_id = r.department_id and c.is_active);
  if me.role <> 'head' and public._category_required(r.department_id) then
    if r.category_id is null then raise exception 'Select the work category for this request'; end if;
    if not v_cat_ok then raise exception 'The selected work category is no longer available. Pick another one'; end if;
  elsif r.category_id is not null and not v_cat_ok then
    update public.requests set category_id = null, category_name = null where id = r.id;
    r.category_id := null;
  end if;

  -- Asset Buying (regular): min 2 bills or quotations
  if r.request_type = 'asset' then
    select count(*) into n from public.request_files
     where request_id = r.id and kind = 'document' and added_by is null
       and quote_amount is not null and nullif(btrim(coalesce(quote_vendor, '')), '') is not null;
    if n < 2 then raise exception 'Attach at least 2 bills or quotations, each with vendor name and amount (% so far)', n; end if;
    update public.request_files set quote_status = 'pending' where request_id = r.id and quote_amount is not null;
    update public.requests set selected_quote_id = null, quote_selected_by = null, quote_selected_by_name = null,
      quote_selected_at = null where id = r.id;
    perform public._sync_asset_amount(r.id);
  end if;

  -- Asset Buying Below 20k: amount max 20000, min 1 bill or quotation
  if r.request_type = 'asset_below_20k' then
    if r.amount > 20000 then
      raise exception 'Amount cannot exceed ₹20,000 for Asset Buying Below 20k';
    end if;
    select count(*) into n from public.request_files
     where request_id = r.id and kind = 'document' and added_by is null
       and quote_amount is not null and nullif(btrim(coalesce(quote_vendor, '')), '') is not null;
    if n < 1 then raise exception 'Attach at least 1 bill or quotation with vendor name and amount'; end if;
    update public.request_files set quote_status = 'pending' where request_id = r.id and quote_amount is not null;
    update public.requests set selected_quote_id = null, quote_selected_by = null, quote_selected_by_name = null,
      quote_selected_at = null where id = r.id;
    perform public._sync_asset_amount(r.id);
  end if;

  -- Routing target for employees: check Regional Head
  if me.role = 'employee' then
    if me.regional_head_id is not null then
      select * into rh from public.profiles p
       where p.id = me.regional_head_id and p.role = 'regional_head' and p.is_active;
    end if;

    if rh.id is null and me.shop_id is not null then
      select count(*) into v_rh_count from public.profiles p
        join public.regional_head_shops s on s.regional_head_id = p.id
       where p.role = 'regional_head' and p.is_active
         and s.shop_id = me.shop_id;
      if v_rh_count = 1 then
        select p.* into rh from public.profiles p
          join public.regional_head_shops s on s.regional_head_id = p.id
         where p.role = 'regional_head' and p.is_active
           and s.shop_id = me.shop_id;
      elsif v_rh_count > 1 then
        raise exception 'Your Regional Head is not assigned yet. Ask your Head to assign one before submitting';
      end if;
    end if;
    v_next := case when rh.id is not null then 'pending_regional_review' else 'submitted' end;
  else
    v_next := 'submitted';
  end if;

  v_no := coalesce(r.request_no, public.next_number(
    coalesce((select value #>> '{}' from public.app_settings where key = 'request_prefix'), 'REQ')));

  if me.role = 'head' then
    update public.requests set
      status = 'pending_admin_approval',
      request_no = v_no,
      route = 'A',
      routed_by = me.id,
      routed_at = now(),
      reviewed_by = me.id,
      reviewed_by_name = me.full_name,
      reviewed_at = now(),
      regional_head_id = null,
      regional_head_name = null,
      regional_forwarded_at = null,
      submitted_at = coalesce(submitted_at, now()),
      updated_at = now()
    where id = r.id;

    perform public._log_action(r.id, me, 'submitted', r.status, 'pending_admin_approval',
      'Department Head request routed directly to Admin for approval', true);
    perform public.notify_next_actor(r.id, 'pending_admin_approval');
  else
    update public.requests set
      status = v_next,
      request_no = v_no,
      route = null,
      routed_by = null,
      routed_at = null,
      reviewed_by = null,
      reviewed_by_name = null,
      reviewed_at = null,
      regional_head_id = rh.id,
      regional_head_name = rh.full_name,
      regional_forwarded_at = null,
      submitted_at = coalesce(submitted_at, now()),
      updated_at = now()
    where id = r.id;

    perform public._log_action(r.id, me, 'submitted', r.status, v_next, null, true);
    perform public.notify_next_actor(r.id, v_next);
  end if;
end $function$;

-- ───────────────────────── 7. Update route_request ────────────────────────────

create or replace function public.route_request(
  p_request_id uuid,
  p_route public.approval_route,
  p_remarks text default null::text
)
returns void language plpgsql security definer set search_path to '' as $function$
declare
  me public.profiles;
  r public.requests;
  threshold numeric;
  next_status public.request_status;
  has_head boolean;
  v_route public.approval_route;
begin
  me := public._me();
  if me.role is distinct from 'clerk' then raise exception 'Only a clerk can route requests'; end if;
  select * into r from public.requests where id = p_request_id for update;
  if r.id is null or r.department_id <> me.department_id then raise exception 'Not found'; end if;
  if r.status <> 'submitted' then raise exception 'Not waiting for clerk routing'; end if;
  if not (me.id = any(public._clerk_ids_for(r.department_id, r.category_id))) then
    raise exception 'This request is for the % clerk', coalesce(r.category_name, 'assigned');
  end if;

  select value::numeric into threshold from public.app_settings where key = 'high_value_threshold';
  threshold := coalesce(threshold, 10000);

  select exists (
    select 1 from public.profiles
    where department_id = r.department_id and role = 'head' and is_active
  ) into has_head;

  -- Asset request handling
  if r.request_type = 'asset' or r.request_type = 'asset_below_20k' then
    if r.requester_role = 'head' or not has_head then
      next_status := 'pending_admin_approval'; v_route := 'A';
    else
      next_status := 'pending_head_review'; v_route := null;
    end if;
    update public.requests set
      status = next_status,
      route = v_route,
      routed_by = me.id,
      routed_at = now(),
      updated_at = now()
    where id = r.id;
    perform public._log_action(r.id, me, 'sent_for_quote_selection', r.status, next_status, p_remarks, true);
    perform public.notify_next_actor(r.id, next_status);
    return;
  end if;

  -- Stock Transfer: "the head level approval is enough", no disbursement step
  if r.request_type = 'stock_transfer' then
    if r.requester_role = 'head' or not has_head then
      next_status := 'pending_admin_approval'; v_route := 'A';
    else
      next_status := 'pending_head_approval'; v_route := 'B';
    end if;
    update public.requests set
      status = next_status,
      route = v_route,
      routed_by = me.id,
      routed_at = now(),
      updated_at = now()
    where id = r.id;
    perform public._log_action(r.id, me, case when v_route = 'A' then 'routed_A' else 'routed_B' end, r.status, next_status, p_remarks, true);
    perform public.notify_next_actor(r.id, next_status);
    return;
  end if;

  -- Discount request handling: always Route B
  if r.request_type = 'discount' and p_route <> 'B' and has_head and r.requester_role <> 'head' then
    raise exception 'Discount approvals need B-level (Head) approval';
  end if;

  if p_route = 'B' then
    if r.request_type not in ('discount', 'stock_transfer') and r.amount > threshold then
      raise exception 'Above threshold: Admin approval required';
    end if;
    if r.requester_role = 'head' then raise exception 'A head cannot approve own request'; end if;
    if not has_head then raise exception 'Department has no active head'; end if;
    next_status := 'pending_head_approval';
  elsif r.requester_role = 'head' or not has_head then
    next_status := 'pending_admin_approval';
  else
    next_status := 'pending_head_review';
  end if;

  update public.requests set
    status = next_status,
    route = p_route,
    routed_by = me.id,
    routed_at = now(),
    updated_at = now()
  where id = r.id;

  perform public._log_action(r.id, me, case when p_route = 'A' then 'routed_A' else 'routed_B' end, r.status, next_status, p_remarks, true);
  perform public.notify_next_actor(r.id, next_status);
end $function$;

-- ───────────────────────── 8. Update RLS & can_view_request ───────────────────

drop policy if exists requests_select on public.requests;
create policy requests_select on public.requests for select using (
  ((select public.my_role()) is not null) and (
    (requester_id = (select auth.uid()))
    or (((select public.my_role()) = 'admin'::public.app_role) and (status <> 'draft'::public.request_status))
    or (((select public.my_role()) = any (array['clerk'::public.app_role, 'head'::public.app_role]))
        and (department_id = (select public.my_department())) and (status <> 'draft'::public.request_status))
    or (((select public.my_role()) = 'head'::public.app_role)
        and (owner_head_id = (select auth.uid())) and (status <> 'draft'::public.request_status))
    or (((select public.my_role()) = 'head'::public.app_role)
        and exists (select 1 from public.profiles p where p.id = (select auth.uid()) and p.can_view_exhibition_waitlist)
        and is_waitlist and (status <> 'draft'::public.request_status))
    or (((select public.my_role()) = 'regional_head'::public.app_role)
        and ((regional_head_id = (select auth.uid())) or (requester_id = (select auth.uid())))
        and (status <> 'draft'::public.request_status or requester_id = (select auth.uid())))
    or (((select public.my_role()) = 'disbursement'::public.app_role)
        and (status = any (array['approved'::public.request_status, 'paid'::public.request_status, 'cancelled'::public.request_status]))
        and (request_type not in ('discount'::public.request_type, 'non_cash'::public.request_type, 'stock_transfer'::public.request_type)))
    or (request_type = 'exhibition'::public.request_type and status not in ('rejected'::public.request_status, 'withdrawn'::public.request_status, 'cancelled'::public.request_status))
    or exists (select 1 from public.head_consultations hc
                where hc.request_id = requests.id and hc.head_id = (select auth.uid()))
  )
);

create or replace function public.can_view_request(p_request_id uuid)
 returns boolean language sql stable security definer set search_path to '' as $function$
  select exists (
    select 1
    from public.requests r
    join public.profiles me on me.id = auth.uid() and me.is_active
    where r.id = p_request_id
      and (
        r.requester_id = me.id
        or (me.role = 'admin' and r.status <> 'draft')
        or (me.role in ('clerk','head') and (r.department_id = me.department_id or r.owner_head_id = me.id) and r.status <> 'draft')
        or (me.role = 'head' and me.can_view_exhibition_waitlist and r.is_waitlist and r.status <> 'draft')
        or (me.role = 'regional_head' and (r.regional_head_id = me.id or r.requester_id = me.id) and (r.status <> 'draft' or r.requester_id = me.id))
        or (me.role = 'disbursement' and r.status in ('approved','paid','cancelled') and r.request_type not in ('discount', 'non_cash', 'stock_transfer'))
        or (r.request_type = 'exhibition' and r.status not in ('rejected', 'withdrawn', 'cancelled'))
        or exists (
          select 1 from public.head_consultations hc
          where hc.request_id = r.id and hc.head_id = me.id
        )
      )
  )
$function$;

notify pgrst, 'reload schema';
