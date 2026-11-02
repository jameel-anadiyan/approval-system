-- ============================================================================
-- 0080_agreement_statutory_audit_workflow.sql
--
-- Adds full backend workflow, validation, broad document upload support,
-- routing rules, stamping safety, and department access management for:
--   1. 'agreement' ("Agreement")
--      - Title, Description, optional Voice Note, Documents (Excel, Word, PDF,
--        PNG, JPG, any image, etc.)
--      - Non-cash item (amount = 0), NO disbursement needed
--      - Department Head approval ONLY (Route B; never requires Admin approval)
--   2. 'statutory_payment' ("Statutory Payment")
--      - Title, Description, Documents, optional Voice Note, Payment Amount,
--        Payment Date, Due Date
--      - Payable item (uses Disbursement Entry & Payment workflow)
--      - Department Head approval ONLY (Route B, regardless of amount/threshold)
--   3. 'audit_report' ("Audit Report")
--      - Title, Description, optional Voice Note, Documents (Excel, Word, PDF,
--        any image, etc.), Audit Period (From - To), Audit Report of Which Firm
--      - Non-cash item (amount = 0), NO disbursement needed
--      - Administrator approval ONLY (Route A -> Admin final approval)
--
-- Also automatically enables 'agreement', 'statutory_payment', and 'audit_report'
-- for Department Head Ayisha and her related Clerks, Employees & Regional Heads,
-- plus provides Admin RPCs to enable/update access for other departments later.
-- ============================================================================

-- 1. Expand 'request-files' bucket size limit (25 MB) & allow Office / Image / PDF / Audio MIME types
update storage.buckets
set file_size_limit = greatest(coalesce(file_size_limit, 20971520), 26214400),
    allowed_mime_types = null
where id = 'request-files';

-- 2. RPC: Update a user's allowed_types reliably (works even without redeploying admin-users Edge Function)
create or replace function public.set_user_allowed_types(
  p_user_id uuid,
  p_allowed_types text[]
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  me public.profiles;
  target public.profiles;
  v_valid_labels text[];
  v_clean text[];
  v_t text;
begin
  me := public._me();
  if me.role not in ('admin', 'head') then
    raise exception 'Only Admin or a Department Head can update request type access';
  end if;

  select * into target from public.profiles where id = p_user_id for update;
  if target.id is null then
    raise exception 'User not found';
  end if;

  if me.role = 'head' then
    if target.role not in ('clerk', 'employee', 'regional_head')
       or target.department_id is distinct from me.department_id then
      raise exception 'Department Heads can only manage Clerks, Regional Heads, and Employees in their own department';
    end if;
  end if;

  select array_agg(e.enumlabel::text)
    into v_valid_labels
    from pg_enum e
    join pg_type t on t.oid = e.enumtypid
    join pg_namespace n on n.oid = t.typnamespace
   where n.nspname = 'public'
     and t.typname = 'request_type';

  v_clean := array[]::text[];
  foreach v_t in array coalesce(p_allowed_types, array[]::text[]) loop
    v_t := lower(btrim(coalesce(v_t, '')));
    if v_t <> '' and v_t = any(v_valid_labels) and not (v_t = any(v_clean)) then
      -- A Department Head can only grant special restricted types if enabled on the Head themselves
      if me.role = 'head'
         and v_t in ('agreement', 'statutory_payment', 'audit_report')
         and not (v_t = any(coalesce(me.allowed_types::text[], array[]::text[])))
         and not (v_t = any(coalesce(target.allowed_types::text[], array[]::text[]))) then
        raise exception 'Ask Admin to enable % for your Department Head account first', v_t;
      end if;
      v_clean := array_append(v_clean, v_t);
    end if;
  end loop;

  if coalesce(array_length(v_clean, 1), 0) = 0 then
    v_clean := array['general'];
  end if;

  update public.profiles
     set allowed_types = v_clean::public.request_type[],
         updated_at = now()
   where id = target.id;

  insert into public.audit_log (actor_id, actor_name, action, target_type, target_id, details)
  values (
    me.id,
    me.full_name,
    'allowed_types_updated',
    'user',
    target.id::text,
    jsonb_build_object(
      'username', target.username,
      'full_name', target.full_name,
      'allowed_types', to_jsonb(v_clean)
    )
  );

  return jsonb_build_object(
    'success', true,
    'user_id', target.id,
    'allowed_types', to_jsonb(v_clean)
  );
end $$;

revoke execute on function public.set_user_allowed_types(uuid, text[]) from public, anon;
grant execute on function public.set_user_allowed_types(uuid, text[]) to authenticated;

-- 3. RPC: Admin one-click toggle to enable/disable Agreement, Statutory Payment, or Audit Report
--    for a Department Head AND optionally their related Clerks, Employees & Regional Heads
create or replace function public.set_department_special_request_access(
  p_head_id uuid,
  p_request_type text,
  p_enabled boolean,
  p_include_related_staff boolean default true
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  me public.profiles;
  v_head public.profiles;
  v_type text := lower(btrim(coalesce(p_request_type, '')));
  v_updated_count int := 0;
  rec record;
  v_next text[];
begin
  me := public._me();
  if me.role <> 'admin' then
    raise exception 'Only Admin can toggle special department request access';
  end if;

  if v_type not in ('agreement', 'statutory_payment', 'audit_report') then
    raise exception 'Invalid special request type: %', v_type;
  end if;

  select * into v_head from public.profiles where id = p_head_id and role = 'head';
  if v_head.id is null then
    raise exception 'Department Head not found';
  end if;

  for rec in
    select p.id, coalesce(p.allowed_types::text[], array['general']::text[]) as cur_types
      from public.profiles p
     where p.id = v_head.id
        or (
          coalesce(p_include_related_staff, true)
          and p.role in ('clerk', 'employee', 'regional_head')
          and (
            (v_head.department_id is not null and p.department_id = v_head.department_id)
            or p.default_head_id = v_head.id
            or exists (
              select 1 from public.user_heads uh
              where uh.user_id = p.id
                and uh.head_id = v_head.id
                and uh.is_default = true
            )
          )
        )
  loop
    if coalesce(p_enabled, false) then
      if v_type = any(rec.cur_types) then
        v_next := rec.cur_types;
      else
        v_next := array_append(rec.cur_types, v_type);
      end if;
    else
      v_next := array_remove(rec.cur_types, v_type);
      if coalesce(array_length(v_next, 1), 0) = 0 then
        v_next := array['general'];
      end if;
    end if;

    update public.profiles
       set allowed_types = v_next::public.request_type[],
           updated_at = now()
     where id = rec.id;

    v_updated_count := v_updated_count + 1;
  end loop;

  insert into public.audit_log (actor_id, actor_name, action, target_type, target_id, details)
  values (
    me.id,
    me.full_name,
    'department_special_request_toggled',
    'user',
    v_head.id::text,
    jsonb_build_object(
      'head_name', v_head.full_name,
      'request_type', v_type,
      'enabled', coalesce(p_enabled, false),
      'include_related_staff', coalesce(p_include_related_staff, true),
      'updated_users', v_updated_count
    )
  );

  return jsonb_build_object(
    'success', true,
    'head_id', v_head.id,
    'request_type', v_type,
    'enabled', coalesce(p_enabled, false),
    'updated_users', v_updated_count
  );
end $$;

revoke execute on function public.set_department_special_request_access(uuid, text, boolean, boolean) from public, anon;
grant execute on function public.set_department_special_request_access(uuid, text, boolean, boolean) to authenticated;

-- 4. Idempotent bootstrap: automatically enables Agreement, Statutory Payment, and Audit Report
--    for Department Head Ayisha and her related Clerks, Employees & Regional Heads once.
create or replace function public.ensure_ayisha_special_requests_enabled()
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_already text;
  v_head record;
  v_staff record;
  v_next text[];
  v_heads_matched int := 0;
  v_users_updated int := 0;
  v_special text[] := array['agreement', 'statutory_payment', 'audit_report'];
  v_t text;
begin
  select value #>> '{}' into v_already
    from public.app_settings
   where key = 'ayisha_special_requests_seeded_v1';

  if v_already = 'true' then
    return jsonb_build_object('seeded', true, 'already_done', true);
  end if;

  for v_head in
    select p.id, p.full_name, p.department_id, coalesce(p.allowed_types::text[], array['general']::text[]) as cur_types
      from public.profiles p
      left join public.departments d on d.id = p.department_id
     where p.role = 'head'
       and (
         p.full_name ilike '%ayisha%'
         or p.username ilike '%ayisha%'
         or p.full_name ilike '%aisha%'
         or p.username ilike '%aisha%'
         or p.full_name ilike '%ayesha%'
         or p.username ilike '%ayesha%'
         or coalesce(d.name, '') ilike '%ayisha%'
       )
  loop
    v_heads_matched := v_heads_matched + 1;

    -- Enable on Ayisha (Head) + all related Clerks, Employees, and Regional Heads
    for v_staff in
      select u.id, coalesce(u.allowed_types::text[], array['general']::text[]) as cur_types
        from public.profiles u
       where u.id = v_head.id
          or (
            u.role in ('clerk', 'employee', 'regional_head')
            and (
              (v_head.department_id is not null and u.department_id = v_head.department_id)
              or u.default_head_id = v_head.id
              or exists (
                select 1 from public.user_heads uh
                where uh.user_id = u.id
                  and uh.head_id = v_head.id
                  and uh.is_default = true
              )
            )
          )
    loop
      v_next := v_staff.cur_types;
      foreach v_t in array v_special loop
        if not (v_t = any(v_next)) then
          v_next := array_append(v_next, v_t);
        end if;
      end loop;

      if v_next is distinct from v_staff.cur_types then
        update public.profiles
           set allowed_types = v_next::public.request_type[],
               updated_at = now()
         where id = v_staff.id;
        v_users_updated := v_users_updated + 1;
      end if;
    end loop;
  end loop;

  if v_heads_matched > 0 then
    insert into public.app_settings (key, value, updated_at)
    values ('ayisha_special_requests_seeded_v1', '"true"'::jsonb, now())
    on conflict (key) do update set value = '"true"'::jsonb, updated_at = now();
  end if;

  return jsonb_build_object(
    'seeded', v_heads_matched > 0,
    'heads_matched', v_heads_matched,
    'users_updated', v_users_updated
  );
end $$;

revoke execute on function public.ensure_ayisha_special_requests_enabled() from public, anon;
grant execute on function public.ensure_ayisha_special_requests_enabled() to authenticated, service_role;

-- 5. Update _build_details for agreement, statutory_payment, and audit_report
create or replace function public._build_details(p_type public.request_type, p_amount numeric, p jsonb)
returns jsonb language plpgsql immutable set search_path = '' as $function$
declare
  d jsonb := coalesce(p, '{}'::jsonb);
  v_before numeric; v_after numeric; v_excl numeric; v_gst_pct numeric; v_gst numeric; v_total numeric;
  v_has_gst boolean; v_base numeric; v_gen_gst numeric; v_gen_rate numeric;
  v_mode text;
  v_items jsonb;
  v_item jsonb;
  v_pieces int := 0;
  v_gross_wt numeric := 0;
  v_mrp_total numeric := 0;
  v_from_shop text;
  v_to_shop text;
  v_conducting_shop_name text;
  v_pay_date text;
  v_due_date text;
  v_audit_from text;
  v_audit_to text;
  v_audit_firm text;
begin
  if p_type::text = 'agreement' then
    return jsonb_build_object(
      'amount', 0,
      'details', jsonb_strip_nulls(jsonb_build_object(
        'description', public._txt(d, 'description', 4000)
      ))
    );

  elsif p_type::text = 'statutory_payment' then
    if p_amount is null or p_amount <= 0 then
      raise exception 'Payment amount must be greater than zero';
    end if;
    v_pay_date := public._txt(d, 'payment_date', 40);
    v_due_date := public._txt(d, 'due_date', 40);
    if v_pay_date is null then
      raise exception 'Payment date is required for Statutory Payment requests';
    end if;
    if v_due_date is null then
      raise exception 'Due date is required for Statutory Payment requests';
    end if;
    return jsonb_build_object(
      'amount', round(p_amount, 2),
      'details', jsonb_strip_nulls(jsonb_build_object(
        'payment_amount', round(p_amount, 2),
        'payment_date', v_pay_date,
        'due_date', v_due_date,
        'description', public._txt(d, 'description', 4000)
      ))
    );

  elsif p_type::text = 'audit_report' then
    v_audit_from := public._txt(d, 'audit_from_date', 40);
    v_audit_to := public._txt(d, 'audit_to_date', 40);
    v_audit_firm := public._txt(d, 'audit_firm', 250);
    if v_audit_from is null then
      raise exception 'Audit period From date is required';
    end if;
    if v_audit_to is null then
      raise exception 'Audit period To date is required';
    end if;
    if v_audit_to < v_audit_from then
      raise exception 'Audit period To date cannot be earlier than From date';
    end if;
    if v_audit_firm is null then
      raise exception 'Please enter the firm name (Audit Report of Which Firm)';
    end if;
    return jsonb_build_object(
      'amount', 0,
      'details', jsonb_strip_nulls(jsonb_build_object(
        'audit_from_date', v_audit_from,
        'audit_to_date', v_audit_to,
        'audit_firm', v_audit_firm,
        'description', public._txt(d, 'description', 4000)
      ))
    );

  elsif p_type::text = 'petty_cash' then
    if p_amount is null or p_amount <= 0 then
      raise exception 'Amount must be greater than zero';
    end if;
    if p_amount > 1000 then
      raise exception 'Petty Cash amount cannot exceed ₹1,000';
    end if;
    return jsonb_build_object(
      'amount', round(p_amount, 2),
      'details', jsonb_strip_nulls(jsonb_build_object(
        'petty_cash_form', 'petty_cash_form_below_1000',
        'max_limit', 1000,
        'total_amount', round(p_amount, 2)
      ))
    );

  elsif p_type = 'non_cash' then
    return jsonb_build_object(
      'amount', 0,
      'details', jsonb_strip_nulls(jsonb_build_object(
        'associated_value', public._num(d, 'associated_value'),
        'associated_notes', public._txt(d, 'associated_notes', 500)
      ))
    );

  elsif p_type = 'general' then
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
      'details', jsonb_strip_nulls(jsonb_build_object(
        'before_amount', v_before, 'after_amount', v_after,
        'discount_amount', v_before - v_after,
        'discount_pct', round((v_before - v_after) / v_before * 100, 2),
        'customer_name', public._txt(d, 'customer_name', 100),
        'reference', public._txt(d, 'reference', 100),
        'invoice_no', public._txt(d, 'invoice_no', 100),
        'bill_date', public._txt(d, 'bill_date', 50))));

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
    v_mode := public._txt(d, 'transfer_mode', 20);
    if v_mode is null or v_mode not in ('itemized', 'bulk') then
      raise exception 'Stock transfer mode must be itemized or bulk';
    end if;
    if (d->>'from_shop_id') is null or (d->>'to_shop_id') is null then
      raise exception 'Select From Shop and To Shop';
    end if;
    if (d->>'from_shop_id') = (d->>'to_shop_id') then
      raise exception 'From Shop and To Shop cannot be the same';
    end if;

    select name into v_from_shop from public.shops where id = (d->>'from_shop_id')::uuid;
    select name into v_to_shop from public.shops where id = (d->>'to_shop_id')::uuid;

    if v_mode = 'bulk' then
      v_pieces := coalesce((d->>'total_pieces')::int, 0);
      v_gross_wt := round(coalesce((d->>'total_gross_weight')::numeric, 0), 3);
      v_mrp_total := round(coalesce((d->>'total_mrp')::numeric, 0), 2);
      if v_pieces <= 0 then raise exception 'Total pieces count must be at least 1'; end if;
      if v_gross_wt <= 0 then raise exception 'Total gross weight must be greater than 0'; end if;
      if v_mrp_total <= 0 then raise exception 'Total MRP amount must be greater than 0'; end if;
      if p_amount is null or p_amount <= 0 or round(p_amount, 2) <> v_mrp_total then
        raise exception 'Request amount must match total MRP';
      end if;

      return jsonb_build_object(
        'amount', v_mrp_total,
        'details', jsonb_strip_nulls(jsonb_build_object(
          'transfer_mode', 'bulk',
          'from_shop_id', d->>'from_shop_id',
          'from_shop_name', coalesce(v_from_shop, d->>'from_shop_name'),
          'to_shop_id', d->>'to_shop_id',
          'to_shop_name', coalesce(v_to_shop, d->>'to_shop_name'),
          'category_id', d->>'category_id',
          'category_name', d->>'category_name',
          'total_pieces', v_pieces,
          'total_gross_weight', v_gross_wt,
          'total_mrp', v_mrp_total,
          'notes', public._txt(d, 'notes', 1000)
        ))
      );
    else
      v_items := d->'items';
      if v_items is null or jsonb_typeof(v_items) <> 'array' or jsonb_array_length(v_items) = 0 then
        raise exception 'Itemized transfer requires at least one item';
      end if;
      for v_item in select * from jsonb_array_elements(v_items) loop
        v_pieces := v_pieces + 1;
        v_gross_wt := v_gross_wt + round(coalesce((v_item->>'gross_weight')::numeric, 0), 3);
        v_mrp_total := v_mrp_total + round(coalesce((v_item->>'mrp')::numeric, 0), 2);
      end loop;
      if v_mrp_total <= 0 then raise exception 'Total MRP amount must be greater than 0'; end if;

      return jsonb_build_object(
        'amount', round(v_mrp_total, 2),
        'details', jsonb_strip_nulls(jsonb_build_object(
          'transfer_mode', 'itemized',
          'from_shop_id', d->>'from_shop_id',
          'from_shop_name', coalesce(v_from_shop, d->>'from_shop_name'),
          'to_shop_id', d->>'to_shop_id',
          'to_shop_name', coalesce(v_to_shop, d->>'to_shop_name'),
          'items', v_items,
          'total_pieces', v_pieces,
          'total_gross_weight', round(v_gross_wt, 3),
          'total_mrp', round(v_mrp_total, 2),
          'notes', public._txt(d, 'notes', 1000)
        ))
      );
    end if;

  else
    -- Exhibition
    v_excl := public._num(d, 'amount_excl_gst');
    v_gst_pct := public._num(d, 'gst_pct');
    if v_excl is null or v_excl <= 0 then raise exception 'Amount before GST is required'; end if;
    v_gst := case when (d->>'gst_invoice')::boolean
                  then round(v_excl * coalesce(v_gst_pct, 18) / 100, 2)
                  else 0 end;
    v_total := round(v_excl + v_gst, 2);
    if (d->>'conducting_shop_id') ~ '^[0-9a-fA-F-]{36}$' then
      select name into v_conducting_shop_name
      from public.shops
      where id = (d->>'conducting_shop_id')::uuid;
    end if;
    return jsonb_build_object(
      'amount', v_total,
      'details', jsonb_strip_nulls(jsonb_build_object(
        'conducting_shop_id', public._txt(d, 'conducting_shop_id', 60),
        'conducting_shop_name', coalesce(v_conducting_shop_name, public._txt(d, 'conducting_shop_name', 200)),
        'event_name', public._txt(d, 'event_name', 200),
        'organiser_contact', public._txt(d, 'organiser_contact', 200),
        'venue', public._txt(d, 'venue', 200),
        'event_dates', public._txt(d, 'event_dates', 100),
        'event_start', public._txt(d, 'event_start', 30),
        'event_end', public._txt(d, 'event_end', 30),
        'expected_footfall', public._txt(d, 'expected_footfall', 50),
        'stall_size_location', public._txt(d, 'stall_size_location', 100),
        'amount_excl_gst', v_excl,
        'gst_pct', coalesce(v_gst_pct, 18),
        'gst_amount', v_gst,
        'total_incl_gst', v_total,
        'payment_mode_due', public._txt(d, 'payment_mode_due', 50),
        'organiser_gstin', public._txt(d, 'organiser_gstin', 20),
        'gst_invoice', coalesce((d->>'gst_invoice')::boolean, false),
        'provides', d->'provides',
        'provides_other', public._txt(d, 'provides_other', 500),
        'voucher_1000_qty', public._int(d, 'voucher_1000_qty'),
        'voucher_500_qty', public._int(d, 'voucher_500_qty'),
        'voucher_1000_min', public._num(d, 'voucher_1000_min'),
        'voucher_500_min', public._num(d, 'voucher_500_min'),
        'voucher_validity', public._txt(d, 'voucher_validity', 50),
        'lucky_draw', public._txt(d, 'lucky_draw', 500),
        'winners_draw', public._txt(d, 'winners_draw', 500),
        'other_costs', public._num(d, 'other_costs'),
        'total_budget', public._num(d, 'total_budget'),
        'purpose', public._txt(d, 'purpose', 1000),
        'is_waitlist', coalesce((d->>'is_waitlist')::boolean, false))));
  end if;
end $function$;

grant execute on function public._build_details(public.request_type, numeric, jsonb) to authenticated, anon, service_role;

-- 6. Update create_typed_draft to enforce special-request allowed_types even on Heads,
--    and handle agreement / statutory_payment / audit_report cleanly
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
  v_clean_details jsonb;
  v_bank_details jsonb;
  v_disb_mode text;
  v_is_payable boolean;
begin
  me := public._me();
  if me.role not in ('employee','clerk','head','regional_head','admin') then
    raise exception 'Your role cannot raise requests';
  end if;

  if p_type::text in ('agreement', 'statutory_payment', 'audit_report') then
    if not (me.role = 'admin' or p_type = any(me.allowed_types)) then
      raise exception 'You do not have access to raise % requests yet', p_type;
    end if;
  elsif not (
    p_type::text = 'petty_cash'
    or p_type = any(me.allowed_types)
    or (p_type = 'asset_below_20k' and 'asset'::public.request_type = any(me.allowed_types))
    or me.role in ('admin', 'head')
  ) then
    raise exception 'You are not allowed to raise % requests', p_type;
  end if;

  v_clean_details := coalesce(p_details, '{}'::jsonb) - 'shop_id' - 'shop_name';

  if p_type = 'non_cash' then
    v_amount := 0;
  else
    v := public._build_details(p_type, p_amount, v_clean_details);
    v_amount := (v->>'amount')::numeric;
  end if;

  if p_type = 'asset_below_20k' and v_amount > 20000 then
    raise exception 'Amount cannot exceed ₹20,000 for Asset Buying Below 20k';
  end if;
  if p_type::text = 'petty_cash' and v_amount > 1000 then
    raise exception 'Petty Cash amount cannot exceed ₹1,000';
  end if;

  v_title := nullif(btrim(coalesce(p_title, '')), '');
  if v_title is null and p_type::text = 'petty_cash' then
    v_title := 'Petty Cash: ' || left(coalesce(nullif(btrim(coalesce(p_notes, '')), ''), 'Expense'), 60);
  end if;
  if v_title is null and p_type = 'exhibition' then v_title := 'Exhibition: ' || (v->'details'->>'event_name'); end if;
  if v_title is null and (p_type = 'asset' or p_type = 'asset_below_20k') then v_title := 'Asset: ' || (v->'details'->>'asset_name'); end if;
  if v_title is null and p_type = 'non_cash' then v_title := 'Non-Cash Request'; end if;
  if v_title is null and p_type = 'stock_transfer' then
    v_title := 'Stock Transfer: ' || coalesce(v->'details'->>'from_shop_name', 'Shop') || ' → ' || coalesce(v->'details'->>'to_shop_name', 'Shop');
  end if;
  if v_title is null then raise exception 'Title is required'; end if;

  -- Routing / Target Head rules
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
  elsif p_type::text = 'petty_cash' then
    if p_target_head_id is not null then
      select * into v_target_head from public.profiles
      where id = p_target_head_id and role = 'head' and is_active;
      if v_target_head.id is null then
        raise exception 'Selected Petty Cash Dealing Head is not active or not found';
      end if;
      if not v_target_head.is_petty_cash_dealer and me.id <> v_target_head.id then
        raise exception 'Selected Department Head is not enabled as a Petty Cash Dealer';
      end if;
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
  elsif me.role = 'head' then
    v_dept_id := me.department_id;
    v_owner_head_id := me.id;
    v_owner_head_name := me.full_name;
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
  elsif me.department_id is not null then
    select * into v_target_head from public.profiles
    where department_id = me.department_id and role = 'head' and is_active limit 1;
    v_dept_id := me.department_id;
    if v_target_head.id is not null then
      v_owner_head_id := v_target_head.id;
      v_owner_head_name := v_target_head.full_name;
    end if;
  else
    v_dept_id := me.department_id;
  end if;

  -- Shop assignment
  if p_type in ('general', 'non_cash') or p_type::text in ('petty_cash', 'agreement', 'statutory_payment', 'audit_report') then
    v_shop_id := public._resolve_request_shop(me, p_details);
  elsif p_type = 'exhibition' then
    v_shop_id := public._resolve_request_shop(
      me,
      case
        when p_details is not null and (p_details ? 'conducting_shop_id')
          then jsonb_build_object('shop_id', p_details->>'conducting_shop_id')
        else p_details
      end
    );
  else
    v_shop_id := me.shop_id;
  end if;
  if v_shop_id is not null then
    select name into v_shop from public.shops where id = v_shop_id;
  end if;

  if p_type = 'exhibition' and v_shop_id is not null then
    v := jsonb_set(
      v,
      '{details}',
      coalesce(v->'details', '{}'::jsonb) || jsonb_build_object(
        'conducting_shop_id', v_shop_id::text,
        'conducting_shop_name', v_shop
      )
    );
  end if;

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

  v_is_payable := p_type::text not in ('discount', 'non_cash', 'stock_transfer', 'agreement', 'audit_report');

  if v_is_payable then
    v_disb_mode := nullif(coalesce(p_details, '{}'::jsonb)->>'disbursement_mode', '');
    if p_type::text = 'petty_cash' and v_disb_mode is null then
      v_disb_mode := 'cash';
    end if;
    v_bank_details := jsonb_strip_nulls(jsonb_build_object(
      'disbursement_mode', v_disb_mode,
      'enter_bank_details_later', coalesce((coalesce(p_details, '{}'::jsonb)->>'enter_bank_details_later')::boolean, false),
      'bank_account_no', nullif(coalesce(p_details, '{}'::jsonb)->>'bank_account_no', ''),
      'bank_ifsc', nullif(coalesce(p_details, '{}'::jsonb)->>'bank_ifsc', ''),
      'bank_name', nullif(coalesce(p_details, '{}'::jsonb)->>'bank_name', ''),
      'bank_branch', nullif(coalesce(p_details, '{}'::jsonb)->>'bank_branch', ''),
      'bank_account_holder_name', nullif(coalesce(p_details, '{}'::jsonb)->>'bank_account_holder_name', ''),
      'bank_verified', coalesce((coalesce(p_details, '{}'::jsonb)->>'bank_verified')::boolean, false),
      'bank_verification_message', nullif(coalesce(p_details, '{}'::jsonb)->>'bank_verification_message', '')
    ));
  else
    v_disb_mode := null;
    v_bank_details := '{}'::jsonb;
  end if;

  insert into public.requests (
    requester_id, requester_name, requester_role, department_id, title, notes, amount,
    request_type, shop_id, shop_name, details, owner_head_id, owner_head_name,
    region_id, region_name, is_waitlist,
    disbursement_mode, enter_bank_details_later, bank_account_no, bank_ifsc,
    bank_name, bank_branch, bank_account_holder_name, bank_verified, bank_verification_message
  )
  values (
    me.id, me.full_name, me.role, v_dept_id, left(v_title, 200), nullif(btrim(p_notes), ''),
    v_amount, p_type, v_shop_id, v_shop,
    (case when p_type = 'non_cash' then v_clean_details else v->'details' end) || v_bank_details,
    v_owner_head_id, v_owner_head_name,
    v_region_id, v_region_name, v_is_waitlist,
    v_disb_mode,
    case when v_is_payable then coalesce((coalesce(p_details, '{}'::jsonb)->>'enter_bank_details_later')::boolean, false) else false end,
    case when v_is_payable then nullif(coalesce(p_details, '{}'::jsonb)->>'bank_account_no', '') else null end,
    case when v_is_payable then nullif(coalesce(p_details, '{}'::jsonb)->>'bank_ifsc', '') else null end,
    case when v_is_payable then nullif(coalesce(p_details, '{}'::jsonb)->>'bank_name', '') else null end,
    case when v_is_payable then nullif(coalesce(p_details, '{}'::jsonb)->>'bank_branch', '') else null end,
    case when v_is_payable then nullif(coalesce(p_details, '{}'::jsonb)->>'bank_account_holder_name', '') else null end,
    case when v_is_payable then coalesce((coalesce(p_details, '{}'::jsonb)->>'bank_verified')::boolean, false) else false end,
    case when v_is_payable then nullif(coalesce(p_details, '{}'::jsonb)->>'bank_verification_message', '') else null end
  )
  returning id into v_id;

  return v_id;
end $function$;

revoke execute on function public.create_typed_draft(public.request_type, text, numeric, text, jsonb, uuid) from public, anon;
grant execute on function public.create_typed_draft(public.request_type, text, numeric, text, jsonb, uuid) to authenticated;

-- 7. Update update_typed_draft (preserving 0078 returned-request permissions)
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
  v_clean_details jsonb;
  v_bank_details jsonb;
  v_can_edit boolean := false;
  v_disb_mode text;
  target_entry_user public.profiles;
  v_entry_user_id uuid;
  v_entry_user_name text;
  v_is_payable boolean;
begin
  me := public._me();
  select * into r from public.requests where id = p_request_id for update;
  if r.id is null then raise exception 'Request not found'; end if;

  if r.requester_id = me.id and r.status in ('draft', 'returned') then
    v_can_edit := true;
  elsif r.status = 'returned' and (
    me.role = 'admin'
    or (me.role in ('head', 'clerk') and (
          r.department_id = me.department_id
          or r.owner_head_id = me.id
          or r.reviewed_by = me.id
          or r.routed_by = me.id
          or exists (select 1 from public.request_actions a where a.request_id = r.id and a.actor_id = me.id)
          or exists (select 1 from public.head_consultations hc where hc.request_id = r.id and hc.head_id = me.id)
       ))
    or (me.role = 'regional_head' and (
          r.regional_head_id = me.id
          or r.department_id = me.department_id
          or exists (select 1 from public.regional_head_shops rhs where rhs.regional_head_id = me.id and rhs.shop_id = r.shop_id)
          or exists (select 1 from public.request_actions a where a.request_id = r.id and a.actor_id = me.id)
       ))
  ) then
    v_can_edit := true;
  end if;

  if not v_can_edit then
    raise exception 'You do not have permission to edit this request';
  end if;

  v_clean_details := case when p_details is null then null else p_details - 'shop_id' - 'shop_name' end;

  if r.request_type <> 'non_cash' then
    v := public._build_details(r.request_type, coalesce(p_amount, r.amount), coalesce(v_clean_details, r.details));
  end if;

  v_title := nullif(btrim(coalesce(p_title, '')), '');
  if v_title is null and r.request_type::text = 'petty_cash' then
    v_title := 'Petty Cash: ' || left(coalesce(nullif(btrim(coalesce(p_notes, r.notes, '')), ''), 'Expense'), 60);
  end if;
  if v_title is null and r.request_type = 'exhibition' then v_title := 'Exhibition: ' || (v->'details'->>'event_name'); end if;
  if v_title is null and (r.request_type = 'asset' or r.request_type = 'asset_below_20k') then v_title := 'Asset: ' || (v->'details'->>'asset_name'); end if;
  if v_title is null and r.request_type = 'non_cash' then v_title := 'Non-Cash Request'; end if;
  if v_title is null and r.request_type = 'stock_transfer' then
    v_title := 'Stock Transfer: ' || coalesce(v->'details'->>'from_shop_name', 'Shop') || ' → ' || coalesce(v->'details'->>'to_shop_name', 'Shop');
  end if;
  if v_title is null then raise exception 'Title is required'; end if;

  v_shop_id := r.shop_id;
  v_shop_name := r.shop_name;

  if (r.request_type in ('general', 'non_cash') or r.request_type::text in ('petty_cash', 'agreement', 'statutory_payment', 'audit_report'))
     and p_details is not null and p_details ? 'shop_id' then
    v_shop_id := public._resolve_request_shop(me, p_details);
    select name into v_shop_name from public.shops where id = v_shop_id;
  elsif r.request_type = 'exhibition' and p_details is not null and (p_details ? 'conducting_shop_id' or p_details ? 'shop_id') then
    if me.role in ('admin', 'head', 'clerk') or me.id <> r.requester_id then
      if coalesce(nullif(p_details->>'conducting_shop_id', ''), p_details->>'shop_id') ~ '^[0-9a-fA-F-]{36}$' then
        v_shop_id := (coalesce(nullif(p_details->>'conducting_shop_id', ''), p_details->>'shop_id'))::uuid;
      end if;
    else
      v_shop_id := public._resolve_request_shop(
        me,
        jsonb_build_object('shop_id', coalesce(nullif(p_details->>'conducting_shop_id', ''), p_details->>'shop_id'))
      );
    end if;
    select name into v_shop_name from public.shops where id = v_shop_id;
    if v_shop_id is not null and v_shop_name is not null then
      v := jsonb_set(
        v,
        '{details}',
        coalesce(v->'details', '{}'::jsonb) || jsonb_build_object(
          'conducting_shop_id', v_shop_id::text,
          'conducting_shop_name', v_shop_name
        )
      );
    end if;
  elsif (r.request_type in ('general', 'non_cash') or r.request_type::text in ('petty_cash', 'agreement', 'statutory_payment', 'audit_report'))
        and v_shop_id is null then
    v_shop_id := public._resolve_request_shop(me, null);
    select name into v_shop_name from public.shops where id = v_shop_id;
  end if;

  if r.request_type = 'stock_transfer' and (v->'details'->>'from_shop_id') ~ '^[0-9a-fA-F-]{36}$' then
    v_shop_id := (v->'details'->>'from_shop_id')::uuid;
    v_shop_name := coalesce(v->'details'->>'from_shop_name', (select name from public.shops where id = v_shop_id));
  end if;

  v_is_payable := r.request_type::text not in ('discount', 'non_cash', 'stock_transfer', 'agreement', 'audit_report');

  if v_is_payable then
    v_disb_mode := case
      when p_details is not null and (p_details ? 'disbursement_mode') then nullif(p_details->>'disbursement_mode', '')
      else r.disbursement_mode
    end;
    if r.request_type::text = 'petty_cash' and v_disb_mode is null then
      v_disb_mode := 'cash';
    end if;

    v_bank_details := jsonb_strip_nulls(jsonb_build_object(
      'disbursement_mode', v_disb_mode,
      'enter_bank_details_later', case when p_details ? 'enter_bank_details_later' then coalesce((p_details->>'enter_bank_details_later')::boolean, false) else coalesce(r.enter_bank_details_later, false) end,
      'bank_account_no', case when p_details ? 'bank_account_no' then nullif(p_details->>'bank_account_no', '') else r.bank_account_no end,
      'bank_ifsc', case when p_details ? 'bank_ifsc' then nullif(p_details->>'bank_ifsc', '') else r.bank_ifsc end,
      'bank_name', case when p_details ? 'bank_name' then nullif(p_details->>'bank_name', '') else r.bank_name end,
      'bank_branch', case when p_details ? 'bank_branch' then nullif(p_details->>'bank_branch', '') else r.bank_branch end,
      'bank_account_holder_name', case when p_details ? 'bank_account_holder_name' then nullif(p_details->>'bank_account_holder_name', '') else r.bank_account_holder_name end,
      'bank_verified', case when p_details ? 'bank_verified' then coalesce((p_details->>'bank_verified')::boolean, false) else coalesce(r.bank_verified, false) end,
      'bank_verification_message', case when p_details ? 'bank_verification_message' then nullif(p_details->>'bank_verification_message', '') else r.bank_verification_message end
    ));
  else
    v_disb_mode := null;
    v_bank_details := '{}'::jsonb;
  end if;

  v_entry_user_id := case when v_is_payable then r.assigned_entry_user_id else null end;
  v_entry_user_name := case when v_is_payable then r.assigned_entry_user_name else null end;
  if v_is_payable and p_details is not null and p_details ? 'assigned_entry_user_id' then
    if (p_details->>'assigned_entry_user_id') ~ '^[0-9a-fA-F-]{36}$' then
      select * into target_entry_user
      from public.profiles
      where id = (p_details->>'assigned_entry_user_id')::uuid and is_active;
      if target_entry_user.id is not null and target_entry_user.role = 'disbursement' and target_entry_user.disbursement_type = 'entry_only' then
        v_entry_user_id := target_entry_user.id;
        v_entry_user_name := target_entry_user.full_name;
      end if;
    elsif p_details->>'assigned_entry_user_id' is null or p_details->>'assigned_entry_user_id' = '' then
      v_entry_user_id := null;
      v_entry_user_name := null;
    end if;
  end if;

  update public.requests set
    title = left(v_title, 200),
    amount = case when r.request_type::text in ('non_cash', 'agreement', 'audit_report') then 0 else (v->>'amount')::numeric end,
    notes = nullif(btrim(p_notes), ''),
    details = (case when r.request_type = 'non_cash' then coalesce(v_clean_details, r.details) else v->'details' end) || v_bank_details,
    shop_id = v_shop_id,
    shop_name = v_shop_name,
    disbursement_mode = v_disb_mode,
    enter_bank_details_later = case when v_is_payable then (case when p_details ? 'enter_bank_details_later' then coalesce((p_details->>'enter_bank_details_later')::boolean, false) else coalesce(r.enter_bank_details_later, false) end) else false end,
    bank_account_no = case when v_is_payable then (case when p_details ? 'bank_account_no' then nullif(p_details->>'bank_account_no', '') else r.bank_account_no end) else null end,
    bank_ifsc = case when v_is_payable then (case when p_details ? 'bank_ifsc' then nullif(p_details->>'bank_ifsc', '') else r.bank_ifsc end) else null end,
    bank_name = case when v_is_payable then (case when p_details ? 'bank_name' then nullif(p_details->>'bank_name', '') else r.bank_name end) else null end,
    bank_branch = case when v_is_payable then (case when p_details ? 'bank_branch' then nullif(p_details->>'bank_branch', '') else r.bank_branch end) else null end,
    bank_account_holder_name = case when v_is_payable then (case when p_details ? 'bank_account_holder_name' then nullif(p_details->>'bank_account_holder_name', '') else r.bank_account_holder_name end) else null end,
    bank_verified = case when v_is_payable then (case when p_details ? 'bank_verified' then coalesce((p_details->>'bank_verified')::boolean, false) else coalesce(r.bank_verified, false) end) else false end,
    bank_verification_message = case when v_is_payable then (case when p_details ? 'bank_verification_message' then nullif(p_details->>'bank_verification_message', '') else r.bank_verification_message end) else null end,
    assigned_entry_user_id = v_entry_user_id,
    assigned_entry_user_name = v_entry_user_name,
    updated_at = now()
  where id = r.id;

  if r.request_type = 'asset' or r.request_type = 'asset_below_20k' then
    perform public._sync_asset_amount(r.id);
  end if;
end $function$;

revoke execute on function public.update_typed_draft(uuid, text, numeric, text, jsonb) from public, anon;
grant execute on function public.update_typed_draft(uuid, text, numeric, text, jsonb) to authenticated;

-- 8. Update register_file to allow Excel, Word, CSV, PDF, and any image file
create or replace function public.register_file(
  p_request_id uuid,
  p_kind public.file_kind,
  p_storage_path text,
  p_original_name text,
  p_mime_type text,
  p_size_bytes bigint,
  p_page_count int default null,
  p_duration_sec numeric default null
)
returns uuid language plpgsql security definer set search_path = '' as $$
declare
  me public.profiles;
  r public.requests;
  v_id uuid;
  n int;
  is_head boolean;
  is_admin boolean;
  v_mime text := lower(btrim(coalesce(p_mime_type, '')));
  v_name_lower text := lower(btrim(coalesce(p_original_name, '')));
  v_doc_ok boolean := false;
begin
  me := public._me();
  select * into r from public.requests where id = p_request_id for update;
  if r.id is null then raise exception 'Not found'; end if;

  is_head := (
    me.role = 'head' and (
      r.department_id = me.department_id
      or r.owner_head_id = me.id
      or exists (select 1 from public.head_consultations hc where hc.request_id = r.id and hc.head_id = me.id)
    )
  );
  is_admin := (me.role = 'admin');

  if (r.requester_id = me.id and r.status in ('draft','returned')) then
    null;
  elsif r.status = 'returned' and (
    is_admin
    or (me.role in ('head', 'clerk') and (r.department_id = me.department_id or r.owner_head_id = me.id or r.routed_by = me.id))
    or (me.role = 'regional_head' and (r.regional_head_id = me.id or r.department_id = me.department_id))
  ) then
    null;
  elsif (is_head or is_admin) and r.status not in ('approved','rejected','paid','withdrawn','cancelled') then
    null;
  else
    raise exception 'You cannot attach documents to this request at this stage';
  end if;

  if public.storage_request_id(p_storage_path) is distinct from r.id then
    raise exception 'Bad file path';
  end if;

  if not exists (select 1 from storage.objects where bucket_id = 'request-files' and name = p_storage_path) then
    raise exception 'File was not uploaded';
  end if;

  select count(*) into n from public.request_files where request_id = r.id and kind = p_kind;
  if p_kind = 'document' and n >= 25 then
    raise exception 'At most 25 documents per request';
  end if;
  if p_kind = 'voice_note' and n >= 10 then
    raise exception 'At most 10 voice notes per request';
  end if;

  if p_kind = 'document' then
    v_doc_ok := (
      v_mime = 'application/pdf'
      or v_mime like 'image/%'
      or v_mime in (
        'application/msword',
        'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
        'application/vnd.ms-excel',
        'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
        'application/vnd.ms-excel.sheet.macroenabled.12',
        'application/vnd.oasis.opendocument.spreadsheet',
        'application/vnd.oasis.opendocument.text',
        'application/vnd.ms-powerpoint',
        'application/vnd.openxmlformats-officedocument.presentationml.presentation',
        'text/csv',
        'application/csv',
        'text/plain',
        'application/rtf',
        'text/rtf'
      )
      or (
        v_mime in ('', 'application/octet-stream')
        and v_name_lower ~ '\.(pdf|png|jpe?g|webp|gif|bmp|svg|tiff?|heic|heif|avif|ico|xlsx?|xlsm|csv|ods|docx?|odt|rtf|txt|pptx?)$'
      )
    );
    if not v_doc_ok then
      raise exception 'Unsupported document format (%). Upload PDF, Excel, Word, CSV, or any image file.', coalesce(nullif(v_mime, ''), p_original_name);
    end if;
  end if;

  if p_kind = 'voice_note' and v_mime not like 'audio/%' then
    raise exception 'Voice notes must be audio';
  end if;

  insert into public.request_files (
    request_id, kind, storage_path, original_name, mime_type, size_bytes,
    page_count, duration_sec, sort_order,
    added_by, added_by_name, added_by_role
  )
  values (
    r.id, p_kind, p_storage_path, left(p_original_name, 255), coalesce(nullif(v_mime, ''), 'application/octet-stream'), p_size_bytes,
    p_page_count, p_duration_sec, n,
    case when me.id <> r.requester_id then me.id else null end,
    case when me.id <> r.requester_id then me.full_name else null end,
    case when me.id <> r.requester_id then me.role else null end
  )
  returning id into v_id;

  update public.requests set updated_at = now() where id = r.id;

  if me.id <> r.requester_id then
    perform public._log_action(
      r.id, me, 'file_attached', r.status, r.status,
      'Attached extra document: ' || left(p_original_name, 255),
      true
    );
  end if;

  return v_id;
end $$;

revoke execute on function public.register_file(uuid, public.file_kind, text, text, text, bigint, int, numeric) from public, anon;
grant execute on function public.register_file(uuid, public.file_kind, text, text, text, bigint, int, numeric) to authenticated;

-- 9. Helper RPC to sync official generated form PDFs for Agreement / Statutory Payment / Audit Report
--    at sort_order = -1 so both web approval and WhatsApp approval always have a stampable form PDF!
create or replace function public.sync_special_request_form_file(
  p_request_id uuid,
  p_storage_path text,
  p_original_name text,
  p_size_bytes bigint,
  p_page_count int default 1
)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  me public.profiles;
  r public.requests;
  v_id uuid;
  v_clean_name text := coalesce(nullif(btrim(p_original_name), ''), 'Official_Approval_Form.pdf');
begin
  me := public._me();
  select * into r from public.requests where id = p_request_id for update;
  if r.id is null then raise exception 'Request not found'; end if;
  if r.request_type::text not in ('agreement', 'statutory_payment', 'audit_report') then
    raise exception 'sync_special_request_form_file is only for Agreement, Statutory Payment, and Audit Report requests';
  end if;
  if r.status in ('approved', 'rejected', 'paid', 'withdrawn', 'cancelled') then
    raise exception 'Cannot modify files on a finalized request';
  end if;

  if not (
    r.requester_id = me.id
    or me.role = 'admin'
    or (me.role in ('head', 'clerk') and (r.owner_head_id = me.id or r.department_id = me.department_id or r.routed_by = me.id))
    or (me.role = 'regional_head' and (r.regional_head_id = me.id or r.department_id = me.department_id))
  ) then
    raise exception 'Not authorized to sync request form';
  end if;

  if public.storage_request_id(p_storage_path) is distinct from r.id then
    raise exception 'Bad file path';
  end if;

  if not exists (select 1 from storage.objects where bucket_id = 'request-files' and name = p_storage_path) then
    raise exception 'Form PDF file was not uploaded';
  end if;

  delete from public.request_files
  where request_id = r.id
    and kind = 'document'
    and (
      sort_order = -1
      or lower(original_name) like 'agreement_approval_form%'
      or lower(original_name) like 'statutory_payment_approval_form%'
      or lower(original_name) like 'audit_report_approval_form%'
    );

  insert into public.request_files (
    request_id, kind, storage_path, original_name, mime_type, size_bytes,
    page_count, sort_order, added_by, added_by_name, added_by_role
  )
  values (
    r.id, 'document', p_storage_path, left(v_clean_name, 255),
    'application/pdf', p_size_bytes, greatest(1, coalesce(p_page_count, 1)), -1,
    null, null, null
  )
  returning id into v_id;

  return v_id;
end $$;

revoke execute on function public.sync_special_request_form_file(uuid, text, text, bigint, int) from public, anon;
grant execute on function public.sync_special_request_form_file(uuid, text, text, bigint, int) to authenticated;

-- 10. Also allow Head / Admin / Clerk / Regional Head to upload generated form PDFs to 'request-files'
--     before finalization via can_edit_request_files
create or replace function public.can_edit_request_files(p_request_id uuid)
returns boolean language sql stable security definer set search_path = '' as $$
  select exists (
    select 1
    from public.requests r
    join public.profiles me on me.id = auth.uid() and me.is_active
    where r.id = p_request_id
      and (
        (r.requester_id = me.id and r.status in ('draft', 'returned'))
        or (
          r.status = 'returned'
          and (
            me.role = 'admin'
            or (me.role in ('head', 'clerk') and (r.department_id = me.department_id or r.owner_head_id = me.id or r.routed_by = me.id))
            or (me.role = 'regional_head' and (r.regional_head_id = me.id or r.department_id = me.department_id))
          )
        )
        or (
          r.status not in ('approved', 'rejected', 'paid', 'withdrawn', 'cancelled')
          and (
            me.role = 'admin'
            or (
              me.role = 'head'
              and (
                r.department_id = me.department_id
                or r.owner_head_id = me.id
                or exists (select 1 from public.head_consultations hc where hc.request_id = r.id and hc.head_id = me.id)
              )
            )
            or (
              r.request_type::text in ('petty_cash', 'agreement', 'statutory_payment', 'audit_report')
              and (
                r.requester_id = me.id
                or (me.role = 'clerk' and r.department_id = me.department_id)
                or (me.role = 'regional_head' and r.regional_head_id = me.id)
              )
            )
          )
        )
      )
  );
$$;

revoke execute on function public.can_edit_request_files(uuid) from public, anon;
grant execute on function public.can_edit_request_files(uuid) to authenticated;

-- 11. Update can_view_request and requests_select RLS policy so non-cash 'agreement' and 'audit_report'
--     do not appear in Disbursement queues, while 'statutory_payment' DOES appear for Disbursement!
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
        or (me.role = 'disbursement' and coalesce(me.disbursement_type, '') <> 'stock_transfer_monitor'
            and r.status in ('approved','paid','cancelled')
            and r.request_type::text not in ('discount', 'non_cash', 'stock_transfer', 'agreement', 'audit_report'))
        or (me.role = 'disbursement' and me.disbursement_type = 'stock_transfer_monitor'
            and r.request_type = 'stock_transfer' and r.status = 'approved')
        or (r.request_type = 'exhibition' and r.status not in ('rejected', 'withdrawn', 'cancelled'))
        or exists (
          select 1 from public.head_consultations hc
          where hc.request_id = r.id and hc.head_id = me.id
        )
      )
  )
$function$;

revoke execute on function public.can_view_request(uuid) from public, anon;
grant execute on function public.can_view_request(uuid) to authenticated;

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
        and (select public.my_disbursement_type()) = 'entry_only'
        and (status = any (array['approved'::public.request_status, 'paid'::public.request_status, 'cancelled'::public.request_status]))
        and (request_type::text not in ('discount', 'non_cash', 'stock_transfer', 'agreement', 'audit_report'))
        and (assigned_entry_user_id is null or assigned_entry_user_id = (select auth.uid())))
    or (((select public.my_role()) = 'disbursement'::public.app_role)
        and (select public.my_disbursement_type()) = 'entry_approver'
        and (status = any (array['approved'::public.request_status, 'paid'::public.request_status]))
        and (request_type::text not in ('discount', 'non_cash', 'stock_transfer', 'agreement', 'audit_report')))
    or (((select public.my_role()) = 'disbursement'::public.app_role)
        and coalesce((select public.my_disbursement_type()), '') in ('payment_only', '')
        and (status = any (array['approved'::public.request_status, 'paid'::public.request_status, 'cancelled'::public.request_status]))
        and (request_type::text not in ('discount', 'non_cash', 'stock_transfer', 'agreement', 'audit_report')))
    or (((select public.my_role()) = 'disbursement'::public.app_role)
        and (select public.my_disbursement_type()) = 'stock_transfer_monitor'
        and request_type = 'stock_transfer'::public.request_type
        and status = 'approved'::public.request_status)
    or (request_type = 'exhibition'::public.request_type and status not in ('rejected'::public.request_status, 'withdrawn'::public.request_status, 'cancelled'::public.request_status))
    or exists (select 1 from public.head_consultations hc
                where hc.request_id = requests.id and hc.head_id = (select auth.uid()))
  )
);

-- 12. Update assign_disbursement_entry_user to exclude 'agreement' and 'audit_report'
create or replace function public.assign_disbursement_entry_user(
  p_request_id uuid,
  p_entry_user_id uuid
)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  me public.profiles;
  r public.requests;
  target_user public.profiles;
  entry_count int;
  is_requester_draft boolean;
  v_can_assign boolean := false;
begin
  me := public._me();
  select * into r from public.requests where id = p_request_id for update;
  if r.id is null then raise exception 'Request not found'; end if;

  is_requester_draft := (r.requester_id = me.id and r.status in ('draft', 'returned'));

  if is_requester_draft or me.role = 'admin' then
    v_can_assign := true;
  elsif me.role in ('head', 'clerk') and (
    r.department_id = me.department_id
    or r.owner_head_id = me.id
    or r.reviewed_by = me.id
    or r.routed_by = me.id
    or exists (select 1 from public.request_actions a where a.request_id = r.id and a.actor_id = me.id)
    or exists (select 1 from public.head_consultations hc where hc.request_id = r.id and hc.head_id = me.id)
  ) then
    v_can_assign := true;
  elsif me.role = 'regional_head' and (
    r.regional_head_id = me.id
    or r.department_id = me.department_id
    or exists (select 1 from public.regional_head_shops rhs where rhs.regional_head_id = me.id and rhs.shop_id = r.shop_id)
    or exists (select 1 from public.request_actions a where a.request_id = r.id and a.actor_id = me.id)
  ) then
    v_can_assign := true;
  end if;

  if not v_can_assign then
    raise exception 'Permission denied: Only the requester, Regional Head, Department Head, Clerk, or Admin can assign the disbursement entry account';
  end if;

  if r.status in ('cancelled', 'rejected', 'withdrawn') then
    raise exception 'Cannot assign entry account on a % request', r.status;
  end if;

  if r.request_type::text in ('discount', 'non_cash', 'stock_transfer', 'agreement', 'audit_report') then
    raise exception 'Disbursement entry accounts cannot be assigned to non-payment requests';
  end if;

  select count(*) into entry_count
    from public.disbursement_entries
   where request_id = r.id and status <> 'cancelled';

  if entry_count > 0 then
    raise exception 'Selection locked: A disbursement entry has already been created for this request. Entry account cannot be changed.';
  end if;

  select * into target_user from public.profiles where id = p_entry_user_id and is_active;
  if target_user.id is null then
    raise exception 'Target disbursement user not found or inactive';
  end if;
  if target_user.role <> 'disbursement'
     or target_user.disbursement_type is distinct from 'entry_only'
     or (lower(coalesce(target_user.designation, '')) ~ '(approv|check|verif|review|audit)')
     or (lower(coalesce(target_user.username, '')) ~ '(approv|check|verif|review|audit)')
     or (lower(coalesce(target_user.full_name, '')) ~ '(approv|check|verif|review|audit)') then
    raise exception 'Assigned user must be an active Disbursement Entry Only account (Entry Checking / Approver accounts cannot be assigned)';
  end if;

  update public.requests
     set assigned_entry_user_id = target_user.id,
         assigned_entry_user_name = target_user.full_name,
         assigned_entry_at = now(),
         assigned_entry_by = me.id,
         updated_at = now()
   where id = r.id;

  if r.status <> 'draft' then
    perform public._log_action(
      r.id, me, 'assigned_entry_account', r.status, r.status,
      'Assigned Disbursement Entry account to ' || target_user.full_name,
      true
    );
  end if;

  return jsonb_build_object(
    'success', true,
    'request_id', r.id,
    'assigned_entry_user_id', target_user.id,
    'assigned_entry_user_name', target_user.full_name
  );
end $$;

revoke execute on function public.assign_disbursement_entry_user(uuid, uuid) from public, anon;
grant execute on function public.assign_disbursement_entry_user(uuid, uuid) to authenticated;

-- 13. Update submit_request:
--     - 'agreement' & 'statutory_payment': Route B (Department Head approval ONLY; never Admin)
--     - 'audit_report': Route A (Admin approval ONLY)
create or replace function public.submit_request(p_request_id uuid, p_entry_user_id uuid default null)
returns void language plpgsql security definer set search_path = '' as $function$
declare
  me public.profiles;
  r public.requests;
  rh public.profiles;
  pc_head public.profiles;
  dept_head public.profiles;
  v_no text;
  n int;
  v_rh_count int;
  v_next public.request_status;
  v_cat_ok boolean;
  target_entry_user public.profiles;
  v_can_submit boolean := false;
begin
  me := public._me();
  select * into r from public.requests where id = p_request_id for update;
  if r.id is null then raise exception 'Request not found'; end if;
  if r.status not in ('draft', 'returned') then raise exception 'This request cannot be submitted (current status: %)', r.status; end if;

  if r.status = 'draft' then
    if r.requester_id <> me.id then
      raise exception 'Only the requester can submit a draft request';
    end if;
  elsif r.status = 'returned' then
    v_can_submit := (
      r.requester_id = me.id
      or me.role = 'admin'
      or (me.role = 'head' and (
            r.department_id = me.department_id
            or r.owner_head_id = me.id
            or r.reviewed_by = me.id
            or exists (select 1 from public.request_actions a where a.request_id = r.id and a.actor_id = me.id)
            or exists (select 1 from public.head_consultations hc where hc.request_id = r.id and hc.head_id = me.id)
         ))
      or (me.role = 'clerk' and (
            r.department_id = me.department_id
            or r.routed_by = me.id
            or exists (select 1 from public.request_actions a where a.request_id = r.id and a.actor_id = me.id)
         ))
      or (me.role = 'regional_head' and (
            r.regional_head_id = me.id
            or r.department_id = me.department_id
            or exists (select 1 from public.regional_head_shops rhs where rhs.regional_head_id = me.id and rhs.shop_id = r.shop_id)
            or exists (select 1 from public.request_actions a where a.request_id = r.id and a.actor_id = me.id)
         ))
    );
    if not v_can_submit then
      raise exception 'You do not have permission to resubmit this request';
    end if;
  end if;

  if r.shop_id is null and me.shop_id is null and me.role = 'employee' then
    raise exception 'Your shop is not assigned yet. Contact your Department Head before submitting';
  end if;

  if r.request_type::text not in ('non_cash', 'agreement', 'audit_report') and (r.amount is null or r.amount <= 0) then
    raise exception 'Amount must be greater than zero';
  end if;

  if p_entry_user_id is not null and r.request_type::text not in ('discount', 'non_cash', 'stock_transfer', 'agreement', 'audit_report') then
    select * into target_entry_user from public.profiles where id = p_entry_user_id and is_active;
    if target_entry_user.id is null then
      raise exception 'Target disbursement entry account not found or inactive';
    end if;
    if target_entry_user.role <> 'disbursement'
       or target_entry_user.disbursement_type is distinct from 'entry_only'
       or (lower(coalesce(target_entry_user.designation, '')) ~ '(approv|check|verif|review|audit)')
       or (lower(coalesce(target_entry_user.username, '')) ~ '(approv|check|verif|review|audit)')
       or (lower(coalesce(target_entry_user.full_name, '')) ~ '(approv|check|verif|review|audit)') then
      raise exception 'Selected user must be an active Disbursement Entry Only account';
    end if;

    update public.requests set
      assigned_entry_user_id = target_entry_user.id,
      assigned_entry_user_name = target_entry_user.full_name,
      assigned_entry_at = now(),
      assigned_entry_by = me.id
    where id = r.id;

    r.assigned_entry_user_id := target_entry_user.id;
    r.assigned_entry_user_name := target_entry_user.full_name;
  end if;

  -- Petty Cash validation & clerk-skipping routing
  if r.request_type::text = 'petty_cash' then
    if r.amount > 1000 then
      raise exception 'Petty Cash amount cannot exceed ₹1,000';
    end if;
    if nullif(btrim(coalesce(r.notes, '')), '') is null then
      raise exception 'Note is mandatory for Petty Cash requests';
    end if;
    if r.assigned_entry_user_id is null then
      raise exception 'Please select a Disbursement Entry Account for this Petty Cash request';
    end if;

    if me.role = 'head' and (r.owner_head_id is null or r.owner_head_id = me.id) then
      pc_head := null;
    else
      if r.owner_head_id is null then
        raise exception 'Please select a Petty Cash Dealing Head';
      end if;
      select * into pc_head
      from public.profiles
      where id = r.owner_head_id and role = 'head' and is_active;

      if pc_head.id is null or not pc_head.is_petty_cash_dealer then
        raise exception 'Selected Department Head is not an active Petty Cash Dealer';
      end if;
    end if;

    if me.role = 'employee' then
      if me.regional_head_id is not null then
        select p.* into rh from public.profiles p
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
    end if;

    v_no := coalesce(r.request_no, public.next_number(
      coalesce((select value #>> '{}' from public.app_settings where key = 'request_prefix'), 'REQ')));

    if me.role = 'employee' and rh.id is not null then
      update public.requests set
        status = 'pending_regional_review',
        request_no = v_no,
        owner_head_id = pc_head.id,
        owner_head_name = pc_head.full_name,
        department_id = pc_head.department_id,
        category_id = null,
        category_name = null,
        disbursement_mode = coalesce(r.disbursement_mode, 'cash'),
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

      perform public._log_action(r.id, me, case when r.status = 'returned' then 'resubmitted' else 'submitted' end,
        r.status, 'pending_regional_review',
        'Petty Cash submitted to Regional Head (Target Head: ' || pc_head.full_name || ')', true);
      perform public.notify_next_actor(r.id, 'pending_regional_review');
      return;

    elsif pc_head.id is not null then
      update public.requests set
        status = 'pending_head_approval',
        request_no = v_no,
        owner_head_id = pc_head.id,
        owner_head_name = pc_head.full_name,
        department_id = pc_head.department_id,
        category_id = null,
        category_name = null,
        disbursement_mode = coalesce(r.disbursement_mode, 'cash'),
        route = 'B'::public.approval_route,
        routed_by = coalesce(r.routed_by, me.id),
        routed_at = coalesce(r.routed_at, now()),
        reviewed_by = null,
        reviewed_by_name = null,
        reviewed_at = null,
        regional_head_id = null,
        regional_head_name = null,
        regional_forwarded_at = null,
        submitted_at = coalesce(submitted_at, now()),
        updated_at = now()
      where id = r.id;

      perform public._log_action(r.id, me, case when r.status = 'returned' then 'resubmitted' else 'submitted' end,
        r.status, 'pending_head_approval',
        'Petty Cash routed directly to ' || pc_head.full_name || ' (clerk skipped)', true);
      perform public.notify_next_actor(r.id, 'pending_head_approval');
      return;

    else
      update public.requests set
        status = 'pending_admin_approval',
        request_no = v_no,
        category_id = null,
        category_name = null,
        disbursement_mode = coalesce(r.disbursement_mode, 'cash'),
        route = 'A'::public.approval_route,
        routed_by = coalesce(r.routed_by, me.id),
        routed_at = coalesce(r.routed_at, now()),
        reviewed_by = me.id,
        reviewed_by_name = me.full_name,
        reviewed_at = now(),
        regional_head_id = null,
        regional_head_name = null,
        regional_forwarded_at = null,
        submitted_at = coalesce(submitted_at, now()),
        updated_at = now()
      where id = r.id;

      perform public._log_action(r.id, me, case when r.status = 'returned' then 'resubmitted' else 'submitted' end,
        r.status, 'pending_admin_approval',
        'Department Head Petty Cash routed directly to Admin for approval', true);
      perform public.notify_next_actor(r.id, 'pending_admin_approval');
      return;
    end if;
  end if;

  -- Non-Petty-Cash validation
  if me.role in ('head', 'clerk')
     and r.request_type::text not in ('discount', 'non_cash', 'stock_transfer', 'agreement', 'audit_report') then
    if r.assigned_entry_user_id is null then
      raise exception 'Please select a Disbursement Entry Account before submitting this request';
    end if;
  end if;

  if r.request_type::text in ('agreement', 'statutory_payment', 'audit_report') then
    if nullif(btrim(coalesce(r.notes, r.details->>'description', '')), '') is null then
      raise exception 'Description is required before submitting';
    end if;
  end if;

  v_cat_ok := r.category_id is not null and exists (
    select 1 from public.work_categories c
     where c.id = r.category_id and c.department_id = r.department_id and c.is_active);
  if me.role not in ('head', 'clerk', 'admin') and public._category_required(r.department_id) then
    if r.category_id is null then raise exception 'Select the work category for this request'; end if;
    if not v_cat_ok then raise exception 'The selected work category is no longer available. Pick another one'; end if;
  elsif r.category_id is not null and not v_cat_ok then
    update public.requests set category_id = null, category_name = null where id = r.id;
    r.category_id := null;
  end if;

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

  if r.request_type = 'asset_below_20k' then
    if r.amount > 20000 then raise exception 'Amount cannot exceed ₹20,000 for Asset Buying Below 20k'; end if;
    select count(*) into n from public.request_files
     where request_id = r.id and kind = 'document' and added_by is null
       and quote_amount is not null and nullif(btrim(coalesce(quote_vendor, '')), '') is not null;
    if n < 1 then raise exception 'Attach at least 1 bill or quotation with vendor name and amount (% so far)', n; end if;
    update public.request_files set quote_status = 'pending' where request_id = r.id and quote_amount is not null;
    update public.requests set selected_quote_id = null, quote_selected_by = null, quote_selected_by_name = null,
      quote_selected_at = null where id = r.id;
    perform public._sync_asset_amount(r.id);
  end if;

  v_no := coalesce(r.request_no, public.next_number(
    coalesce((select value #>> '{}' from public.app_settings where key = 'request_prefix'), 'REQ')));

  -- Agreement & Statutory Payment: ONLY Department Head approval (Route B; never Admin)
  if r.request_type::text in ('agreement', 'statutory_payment') then
    if me.role in ('head', 'admin', 'clerk') or (me.role = 'regional_head' and r.status = 'returned') then
      if r.owner_head_id is not null then
        select * into dept_head from public.profiles where id = r.owner_head_id and role = 'head' and is_active;
      end if;
      if dept_head.id is null and me.role = 'head' then
        dept_head := me;
      end if;
      if dept_head.id is null and r.department_id is not null then
        select * into dept_head from public.profiles
         where department_id = r.department_id and role = 'head' and is_active limit 1;
      end if;

      update public.requests set
        status = 'pending_head_approval',
        request_no = v_no,
        route = 'B'::public.approval_route,
        owner_head_id = coalesce(dept_head.id, r.owner_head_id),
        owner_head_name = coalesce(dept_head.full_name, r.owner_head_name),
        department_id = coalesce(dept_head.department_id, r.department_id),
        routed_by = coalesce(r.routed_by, me.id),
        routed_at = coalesce(r.routed_at, now()),
        reviewed_by = null,
        reviewed_by_name = null,
        reviewed_at = null,
        regional_head_id = null,
        regional_head_name = null,
        regional_forwarded_at = null,
        submitted_at = coalesce(submitted_at, now()),
        updated_at = now()
      where id = r.id;

      perform public._log_action(r.id, me, case when r.status = 'returned' then 'resubmitted' else 'submitted' end,
        r.status, 'pending_head_approval',
        'Routed directly to Department Head for approval (Route B — Head Approval Only)', true);
      perform public.notify_next_actor(r.id, 'pending_head_approval');
      return;
    end if;
  end if;

  if me.role in ('head', 'admin') then
    update public.requests set
      status = 'pending_admin_approval',
      request_no = v_no,
      route = 'A'::public.approval_route,
      routed_by = coalesce(r.routed_by, me.id),
      routed_at = coalesce(r.routed_at, now()),
      reviewed_by = me.id,
      reviewed_by_name = me.full_name,
      reviewed_at = now(),
      regional_head_id = null,
      regional_head_name = null,
      regional_forwarded_at = null,
      submitted_at = coalesce(submitted_at, now()),
      updated_at = now()
    where id = r.id;

    perform public._log_action(r.id, me, case when r.status = 'returned' then 'resubmitted' else 'submitted' end,
      r.status, 'pending_admin_approval',
      case when r.status = 'returned' then 'Request resubmitted to Admin for approval'
           else 'Department Head request routed directly to Admin for approval' end,
      true);
    perform public.notify_next_actor(r.id, 'pending_admin_approval');

  elsif me.role = 'clerk' then
    if r.request_type::text = 'audit_report'
       or r.request_type = 'exhibition'
       or (r.request_type::text not in ('discount', 'stock_transfer', 'agreement', 'statutory_payment')
           and r.amount > coalesce((select (value #>> '{}')::numeric from public.app_settings where key = 'threshold_amount'), 10000)) then
      v_next := 'pending_head_review';
    else
      v_next := 'pending_head_approval';
    end if;

    update public.requests set
      status = v_next,
      request_no = v_no,
      route = (case when v_next = 'pending_head_review' then 'A'::public.approval_route else 'B'::public.approval_route end),
      routed_by = me.id,
      routed_at = now(),
      reviewed_by = null,
      reviewed_by_name = null,
      reviewed_at = null,
      regional_head_id = null,
      regional_head_name = null,
      regional_forwarded_at = null,
      submitted_at = coalesce(submitted_at, now()),
      updated_at = now()
    where id = r.id;

    perform public._log_action(r.id, me, case when r.status = 'returned' then 'resubmitted' else 'submitted' end,
      r.status, v_next,
      case when r.status = 'returned' then 'Clerk resubmitted request to Department Head for review and approval'
           else 'Clerk request routed directly to Department Head for review and approval' end,
      true);
    perform public.notify_next_actor(r.id, v_next);

  elsif me.role = 'regional_head' and r.status = 'returned' then
    if r.request_type::text = 'audit_report'
       or r.request_type = 'exhibition'
       or (r.request_type::text not in ('discount', 'stock_transfer', 'agreement', 'statutory_payment')
           and r.amount > coalesce((select (value #>> '{}')::numeric from public.app_settings where key = 'threshold_amount'), 10000)) then
      v_next := 'pending_head_review';
    else
      v_next := 'pending_head_approval';
    end if;

    update public.requests set
      status = v_next,
      request_no = v_no,
      route = (case when v_next = 'pending_head_review' then 'A'::public.approval_route else 'B'::public.approval_route end),
      regional_head_id = me.id,
      regional_head_name = me.full_name,
      regional_forwarded_at = now(),
      submitted_at = coalesce(submitted_at, now()),
      updated_at = now()
    where id = r.id;

    perform public._log_action(r.id, me, 'resubmitted', r.status, v_next,
      'Regional Head resubmitted request to Department Head', true);
    perform public.notify_next_actor(r.id, v_next);

  else
    -- Employee (or Regional Head submitting new own request -> clerk)
    if me.role = 'employee' then
      if me.regional_head_id is not null then
        select p.* into rh from public.profiles p
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
    end if;
    v_next := case when rh.id is not null then 'pending_regional_review' else 'submitted' end;

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

    perform public._log_action(r.id, me, case when r.status = 'returned' then 'resubmitted' else 'submitted' end,
      r.status, v_next,
      case when r.status = 'returned' then 'Request resubmitted after correction' else null end,
      true);
    perform public.notify_next_actor(r.id, v_next);
  end if;
end $function$;

revoke execute on function public.submit_request(uuid, uuid) from public, anon;
grant execute on function public.submit_request(uuid, uuid) to authenticated;

-- 14. Update route_request (Clerk routing):
--     - 'agreement' & 'statutory_payment' -> Mandatory Route B (pending_head_approval, even above threshold)
--     - 'audit_report' -> Mandatory Route A (pending_head_review -> Admin final approval)
create or replace function public.route_request(
  p_request_id uuid,
  p_route public.approval_route,
  p_remarks text default null::text,
  p_assigned_entry_user_id uuid default null
)
returns void language plpgsql security definer set search_path to '' as $function$
declare
  me public.profiles;
  r public.requests;
  threshold numeric;
  next_status public.request_status;
  has_head boolean;
  v_route public.approval_route;
  target_entry public.profiles;
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
    where (department_id = r.department_id or id = r.owner_head_id) and role = 'head' and is_active
  ) into has_head;

  if p_assigned_entry_user_id is not null
     and r.request_type::text not in ('discount', 'non_cash', 'stock_transfer', 'agreement', 'audit_report') then
    select * into target_entry from public.profiles where id = p_assigned_entry_user_id and is_active;
    if target_entry.id is not null
       and target_entry.role = 'disbursement'
       and target_entry.disbursement_type = 'entry_only'
       and not (
         lower(coalesce(target_entry.designation, '')) ~ '(approv|check|verif|review|audit)'
         or lower(coalesce(target_entry.username, '')) ~ '(approv|check|verif|review|audit)'
         or lower(coalesce(target_entry.full_name, '')) ~ '(approv|check|verif|review|audit)'
       ) then
      update public.requests set
        assigned_entry_user_id = target_entry.id,
        assigned_entry_user_name = target_entry.full_name,
        assigned_entry_at = now(),
        assigned_entry_by = me.id
      where id = r.id;
    end if;
  end if;

  -- Agreement & Statutory Payment: ONLY Head approval (Route B), never Admin approval
  if r.request_type::text in ('agreement', 'statutory_payment') then
    if p_route <> 'B' then
      raise exception '% requests only require Department Head approval (Route B)',
        case when r.request_type::text = 'agreement' then 'Agreement' else 'Statutory Payment' end;
    end if;
    if not has_head then
      update public.requests set
        route = 'A',
        status = 'pending_admin_approval',
        routed_by = me.id,
        routed_at = now(),
        updated_at = now()
      where id = r.id;
      perform public._log_action(r.id, me, 'routed', 'submitted', 'pending_admin_approval',
        coalesce(p_remarks, '') || ' [Auto Route A: department has no active head]', true);
      perform public.notify_next_actor(r.id, 'pending_admin_approval');
      return;
    end if;
    update public.requests set
      route = 'B',
      status = 'pending_head_approval',
      routed_by = me.id,
      routed_at = now(),
      updated_at = now()
    where id = r.id;
    perform public._log_action(r.id, me, 'routed', 'submitted', 'pending_head_approval', p_remarks, true);
    perform public.notify_next_actor(r.id, 'pending_head_approval');
    return;
  end if;

  -- Audit Report: ONLY Admin approval (Route A)
  if r.request_type::text = 'audit_report' then
    if p_route <> 'A' then
      raise exception 'Audit Report requests are only approved by Admin and must be routed via Route A';
    end if;
    next_status := case when has_head and r.requester_role <> 'head' then 'pending_head_review' else 'pending_admin_approval' end;
    update public.requests set
      route = 'A',
      status = next_status,
      routed_by = me.id,
      routed_at = now(),
      updated_at = now()
    where id = r.id;
    perform public._log_action(r.id, me, 'routed', 'submitted', next_status, p_remarks, true);
    perform public.notify_next_actor(r.id, next_status);
    return;
  end if;

  -- Asset request handling: quotation selection by Head
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

  -- Requester is head -> must go to Admin directly
  if r.requester_role = 'head' then
    update public.requests set
      route = 'A',
      status = 'pending_admin_approval',
      routed_by = me.id,
      routed_at = now(),
      updated_at = now()
    where id = r.id;
    perform public._log_action(r.id, me, 'routed', 'submitted', 'pending_admin_approval', p_remarks, true);
    perform public.notify_next_actor(r.id, 'pending_admin_approval');
    return;
  end if;

  -- Exhibition requests mandatory Route A
  if r.request_type = 'exhibition' then
    if p_route <> 'A' then raise exception 'Exhibition requests must be routed to Route A (Admin)'; end if;
    next_status := case when not has_head then 'pending_admin_approval' else 'pending_head_review' end;
    update public.requests set
      route = 'A',
      status = next_status,
      routed_by = me.id,
      routed_at = now(),
      updated_at = now()
    where id = r.id;
    perform public._log_action(r.id, me, 'routed', 'submitted', next_status, p_remarks, true);
    perform public.notify_next_actor(r.id, next_status);
    return;
  end if;

  -- Discount & Stock Transfer requests mandatory Route B
  if r.request_type = 'discount' or r.request_type = 'stock_transfer' then
    if p_route <> 'B' then
      raise exception '% requests must be routed to Route B (Department Head)',
        case when r.request_type = 'discount' then 'Discount' else 'Stock Transfer' end;
    end if;
    if not has_head then
      update public.requests set
        route = 'A',
        status = 'pending_admin_approval',
        routed_by = me.id,
        routed_at = now(),
        updated_at = now()
      where id = r.id;
      perform public._log_action(r.id, me, 'routed', 'submitted', 'pending_admin_approval',
        coalesce(p_remarks, '') || ' [Auto Route A: department has no active head]', true);
      perform public.notify_next_actor(r.id, 'pending_admin_approval');
      return;
    end if;
    update public.requests set
      route = 'B',
      status = 'pending_head_approval',
      routed_by = me.id,
      routed_at = now(),
      updated_at = now()
    where id = r.id;
    perform public._log_action(r.id, me, 'routed', 'submitted', 'pending_head_approval', p_remarks, true);
    perform public.notify_next_actor(r.id, 'pending_head_approval');
    return;
  end if;

  -- General & Non-Cash requests
  if p_route = 'B' and r.request_type <> 'non_cash' and r.amount > threshold then
    raise exception 'Requests above % must be routed to Route A (Admin)', threshold;
  end if;

  if not has_head then
    update public.requests set
      route = 'A',
      status = 'pending_admin_approval',
      routed_by = me.id,
      routed_at = now(),
      updated_at = now()
    where id = r.id;
    perform public._log_action(r.id, me, 'routed', 'submitted', 'pending_admin_approval',
      coalesce(p_remarks, '') || ' [Auto Route A: department has no active head]', true);
    perform public.notify_next_actor(r.id, 'pending_admin_approval');
    return;
  end if;

  next_status := case when p_route = 'B' then 'pending_head_approval' else 'pending_head_review' end;

  update public.requests set
    route = p_route,
    status = next_status,
    routed_by = me.id,
    routed_at = now(),
    updated_at = now()
  where id = r.id;

  perform public._log_action(r.id, me, 'routed', 'submitted', next_status, p_remarks, true);
  perform public.notify_next_actor(r.id, next_status);
end $function$;

revoke execute on function public.route_request(uuid, public.approval_route, text, uuid) from public, anon;
grant execute on function public.route_request(uuid, public.approval_route, text, uuid) to authenticated;

-- 15. Update head_change_route to lock Agreement/Statutory Payment on Route B and Audit Report on Route A
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
    if r.request_type::text in ('agreement', 'statutory_payment') then
      raise exception '% requests do not require Admin approval and must remain on Route B (Department Head Approval)',
        case when r.request_type::text = 'agreement' then 'Agreement' else 'Statutory Payment' end;
    end if;
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
    if r.request_type::text = 'audit_report' then
      raise exception 'Audit Report requests can only be approved by Admin and must stay on Route A';
    end if;
    if r.status = 'pending_head_approval' and r.route = 'B' then
      raise exception 'This request is already in To Approve (Route B)';
    end if;
    if (r.request_type = 'asset' or r.request_type = 'asset_below_20k') and r.selected_quote_id is null then
      raise exception 'Select the best quotation before changing to Route B';
    end if;
    if r.requester_role = 'head' and r.request_type::text not in ('agreement', 'statutory_payment') then
      raise exception 'A Department Head request must stay on Route A (Admin approval required)';
    end if;
    if r.request_type = 'exhibition' then
      raise exception 'Exhibition requests require Administrator approval and must stay on Route A';
    end if;

    select value::numeric into v_threshold
    from public.app_settings
    where key = 'high_value_threshold';
    v_threshold := coalesce(v_threshold, 10000);

    if r.request_type::text not in ('discount', 'stock_transfer', 'non_cash', 'agreement', 'statutory_payment')
       and r.amount > v_threshold then
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

-- 16. Update begin_approval:
--     - Enforce Admin-only approval on 'audit_report'
--     - Allow Department Head to approve 'agreement' and 'statutory_payment' (including Head's own since Admin approval is not needed)
--     - Filter 'files' passed to PDF stamper to PDF/JPG/PNG so Excel/Word/other attachments never crash pdf-lib
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
  v_mand_ok boolean;
  v_mand_name text;
begin
  select * into me from public.profiles where id = p_approver_id and is_active;
  if me.id is null then raise exception 'Approver not found'; end if;
  select * into r from public.requests where id = p_request_id for update;
  if r.id is null then raise exception 'Not found'; end if;

  if r.status = 'approving' then
    if r.approving_started_at > v_now - interval '1 minute' then
      raise exception 'Approval already in progress';
    end if;
    v_prev := r.status_before_approving;
  else
    v_prev := r.status;
  end if;

  if me.role = 'head' then
    if r.request_type::text = 'audit_report' then
      raise exception 'Audit Report requests can only be approved by the Administrator';
    end if;
    if v_prev <> 'pending_head_approval' then
      raise exception 'This request is not waiting for your approval';
    end if;
    if r.request_type::text = 'petty_cash' and r.owner_head_id is not null then
      if r.owner_head_id <> me.id then
        raise exception 'This Petty Cash request is assigned to another Petty Cash Dealing Head';
      end if;
    elsif not (r.department_id = me.department_id or r.owner_head_id = me.id) then
      raise exception 'This request is not waiting for your approval';
    end if;

    if me.mandatory_head_consultation and me.mandatory_consultation_head_id is not null then
      select exists (
        select 1 from public.head_consultations
        where request_id = r.id
          and head_id = me.mandatory_consultation_head_id
          and status = 'agreed'
      ) into v_mand_ok;

      if not v_mand_ok then
        select full_name into v_mand_name from public.profiles where id = me.mandatory_consultation_head_id;
        raise exception 'Mandatory consultation with % is required and must be agreed before approving this request',
          coalesce(v_mand_name, 'the designated Department Head');
      end if;
    end if;

  elsif me.role = 'admin' then
    if v_prev <> 'pending_admin_approval' then raise exception 'This request is not waiting for your approval'; end if;
  else
    raise exception 'Only a Head or Admin can approve';
  end if;

  if r.requester_id = me.id and not (me.role = 'head' and r.request_type::text in ('agreement', 'statutory_payment')) then
    raise exception 'You cannot approve your own request';
  end if;

  if (r.request_type = 'asset' or r.request_type = 'asset_below_20k') and r.selected_quote_id is null then
    raise exception 'Select the best quotation before approving';
  end if;

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

  update public.requests set
    status = 'approving',
    approval_no = v_no,
    approving_by = me.id,
    approving_started_at = v_now,
    status_before_approving = v_prev,
    decided_at = v_now,
    last_error = null,
    updated_at = v_now
  where id = r.id;

  select * into d from public.departments where id = r.department_id;

  return jsonb_build_object(
    'success', true,
    'approval_no', v_no,
    'decided_at', v_now,
    'department_name', d.name,
    'seal_path', c.seal_path,
    'signature_path', c.signature_path,
    'request', jsonb_build_object(
      'id', r.id,
      'request_no', r.request_no,
      'title', r.title,
      'notes', r.notes,
      'amount', r.amount,
      'route', r.route,
      'requester_id', r.requester_id,
      'requester_name', r.requester_name,
      'owner_head_id', r.owner_head_id,
      'department', d.name,
      'department_code', d.code,
      'submitted_at', r.submitted_at,
      'verify_token', r.verify_token,
      'reviewed_by_name', r.reviewed_by_name,
      'reviewed_at', r.reviewed_at,
      'request_type', r.request_type,
      'details', r.details,
      'shop_name', r.shop_name,
      'owner_head_name', r.owner_head_name,
      'assigned_entry_user_name', r.assigned_entry_user_name,
      'disbursement_mode', r.disbursement_mode,
      'quote_selected_by_name', r.quote_selected_by_name,
      'quote_selected_at', r.quote_selected_at
    ),
    'approver', jsonb_build_object(
      'id', me.id,
      'full_name', me.full_name,
      'designation', me.designation,
      'role', me.role,
      'department', (select name from public.departments where id = me.department_id)
    ),
    'files', coalesce((
      select jsonb_agg(jsonb_build_object(
        'id', f.id,
        'storage_path', f.storage_path,
        'original_name', f.original_name,
        'mime_type', f.mime_type,
        'quote_vendor', f.quote_vendor,
        'quote_amount', f.quote_amount,
        'quote_preferred', f.quote_preferred,
        'quote_status', f.quote_status
      ) order by f.sort_order, f.created_at)
      from public.request_files f
      where f.request_id = r.id
        and f.kind = 'document'
        and lower(coalesce(f.mime_type, '')) in ('application/pdf', 'image/jpeg', 'image/jpg', 'image/png')
    ), '[]'::jsonb),
    'all_documents', coalesce((
      select jsonb_agg(jsonb_build_object(
        'id', f.id,
        'original_name', f.original_name,
        'mime_type', f.mime_type,
        'size_bytes', f.size_bytes
      ) order by f.sort_order, f.created_at)
      from public.request_files f
      where f.request_id = r.id and f.kind = 'document'
    ), '[]'::jsonb),
    'timeline', coalesce((
      select jsonb_agg(jsonb_build_object(
        'actor_name', a.actor_name,
        'actor_role', a.actor_role,
        'action', a.action,
        'remarks', a.remarks,
        'created_at', a.created_at
      ) order by a.created_at)
      from public.request_actions a
      where a.request_id = r.id
    ), '[]'::jsonb)
  );
end $$;

revoke execute on function public.begin_approval(uuid, uuid) from public, anon, authenticated;
grant execute on function public.begin_approval(uuid, uuid) to service_role;

-- 16b. Update notify_next_actor so non-payable Agreement & Audit Report never notify Disbursement accounts
create or replace function public.notify_next_actor(p_request_id uuid, p_status public.request_status)
returns void
language plpgsql
security definer
set search_path to ''
as $function$
declare
  r public.requests;
  ids uuid[];
  label text;
begin
  select * into r from public.requests where id = p_request_id;
  if r.id is null then return; end if;
  label := coalesce(r.request_no, 'Request') || ' - ' || r.title;

  if p_status = 'submitted' then
    select array_agg(u) into ids from unnest(public._clerk_ids_for(r.department_id, r.category_id)) u
     where u is not null;
    perform public._notify(ids, r.id, 'New request to route', label);

  elsif p_status = 'pending_regional_review' then
    if r.regional_head_id is not null then
      perform public._notify(array[r.regional_head_id], r.id, 'Request waiting for your review', label);
    end if;

  elsif p_status in ('pending_head_review','pending_head_approval') then
    select array_agg(id) into ids from public.profiles
     where (id = r.owner_head_id or (department_id = r.department_id and role = 'head')) and is_active;
    perform public._notify(ids, r.id,
      case when p_status = 'pending_head_review' then 'Request waiting for your review' else 'Request waiting for your approval' end,
      label);

  elsif p_status = 'pending_admin_approval' then
    select array_agg(id) into ids from public.profiles where role = 'admin' and is_active;
    perform public._notify(ids, r.id, 'Request waiting for Admin approval', label);

  elsif p_status = 'returned' then
    select array_agg(distinct u) into ids
    from (
      select r.requester_id as u
      union
      select r.regional_head_id as u
      union
      select r.routed_by as u
      union
      select r.owner_head_id as u
      union
      select p.id as u from public.profiles p
       where p.is_active
         and p.role = 'head'
         and p.department_id = r.department_id
         and (r.owner_head_id is null or r.owner_head_id = p.id)
      union
      select p.id as u from public.profiles p
       where p.is_active
         and p.role = 'clerk'
         and p.department_id = r.department_id
         and (r.routed_by is null or r.routed_by = p.id)
    ) sub
    where u is not null;
    perform public._notify(ids, r.id, 'Returned for correction', label);

  elsif p_status = 'rejected' then
    perform public._notify(array[r.requester_id], r.id, 'Request rejected', label);

  elsif p_status = 'approved' then
    select array_agg(id) into ids from public.profiles
      where is_active and (
        id = r.requester_id
        or id = r.regional_head_id
        or (role = 'disbursement'
            and coalesce(disbursement_type, '') <> 'stock_transfer_monitor'
            and r.request_type::text not in ('discount', 'non_cash', 'stock_transfer', 'agreement', 'audit_report'))
        or (role = 'disbursement'
            and disbursement_type = 'stock_transfer_monitor'
            and r.request_type = 'stock_transfer')
        or (role in ('clerk','head') and (department_id = r.department_id or id = r.owner_head_id)));
    perform public._notify(ids, r.id,
      case when r.request_type = 'stock_transfer' then 'Stock transfer approved - ' else 'Approved - ' end
        || coalesce(r.approval_no, ''),
      label);

  elsif p_status = 'paid' then
    perform public._notify(array[r.requester_id], r.id, 'Paid', label);
  end if;
end $function$;

revoke execute on function public.notify_next_actor(uuid, public.request_status) from public, anon, authenticated;

-- 17. Attempt immediate enablement for Ayisha & related staff (safe if executed in same transaction as enum addition)
do $$
begin
  perform public.ensure_ayisha_special_requests_enabled();
exception
  when sqlstate '55P04' then
    raise notice 'Enum values added; Ayisha department access will auto-seed on next query/session.';
  when others then
    raise notice 'Ayisha auto-seed note: %', sqlerrm;
end $$;

notify pgrst, 'reload schema';
