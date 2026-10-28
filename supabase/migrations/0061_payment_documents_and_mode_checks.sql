-- ==============================================================================
-- Migration 0061: Payment reference document upload & strict Cash/Bank mode checks
-- 
-- 1. Adds document_storage_path & document_name to request_payments for optional
--    document uploads during payment disbursement (future reference / audit).
-- 2. Enforces strict mode alignment:
--    - When entry is cash, payment_mode must be 'Cash' (bank modes rejected).
--    - When entry is bank, payment_mode cannot be 'Cash' (cash rejected).
-- 3. Grants storage insert permission on request-files for disbursement payment docs.
-- ==============================================================================

-- 1. Add document columns to request_payments
alter table public.request_payments
  add column if not exists document_storage_path text,
  add column if not exists document_name text;

-- 2. Storage upload, delete, and read permission for payment attachments
create or replace function public.can_upload_payment_doc(p_request_id uuid default null)
returns boolean language sql stable security definer set search_path = '' as $$
  select exists (
    select 1 from public.profiles me
    where me.id = auth.uid() and me.is_active
      and (me.role = 'admin' or me.role = 'disbursement')
  ) and (
    p_request_id is null or exists (
      select 1 from public.requests r
      where r.id = p_request_id and r.status in ('approved', 'paid')
    )
  );
$$;
revoke execute on function public.can_upload_payment_doc(uuid) from public, anon;
grant execute on function public.can_upload_payment_doc(uuid) to authenticated;

drop policy if exists "request-files payment doc insert" on storage.objects;
create policy "request-files payment doc insert" on storage.objects for insert to authenticated
  with check (
    bucket_id = 'request-files'
    and (split_part(name, '/', 2) like 'payment-%' or name like '%/payment-%' or name like 'payment-%')
    and exists (
      select 1 from public.profiles me
      where me.id = auth.uid() and me.is_active
        and (me.role = 'admin' or me.role = 'disbursement')
    )
  );

drop policy if exists "request-files payment doc delete" on storage.objects;
create policy "request-files payment doc delete" on storage.objects for delete to authenticated
  using (
    bucket_id = 'request-files'
    and (split_part(name, '/', 2) like 'payment-%' or name like '%/payment-%' or name like 'payment-%')
    and exists (
      select 1 from public.profiles me
      where me.id = auth.uid() and me.is_active
        and (me.role = 'admin' or me.role = 'disbursement')
    )
  );

drop policy if exists "request-files payment doc read" on storage.objects;
create policy "request-files payment doc read" on storage.objects for select to authenticated
  using (
    bucket_id = 'request-files'
    and (split_part(name, '/', 2) like 'payment-%' or name like '%/payment-%' or name like 'payment-%')
    and (
      exists (
        select 1 from public.profiles me
        where me.id = auth.uid() and me.is_active
          and (me.role = 'admin' or me.role = 'disbursement')
      )
      or public.can_view_request(public.storage_request_id(name))
    )
  );

-- Safeguard: ensure request_actions.visible_to_requester drops strict not-null, defaults to true and coalesce inside _log_action
alter table public.request_actions alter column visible_to_requester drop not null;
alter table public.request_actions alter column visible_to_requester set default true;

create or replace function public.trg_request_actions_visible_default()
returns trigger language plpgsql security definer set search_path = '' as $$
begin
  if new.visible_to_requester is null then
    new.visible_to_requester := true;
  end if;
  return new;
end;
$$;

drop trigger if exists trg_request_actions_visible_default on public.request_actions;
create trigger trg_request_actions_visible_default
  before insert on public.request_actions
  for each row
  execute function public.trg_request_actions_visible_default();

create or replace function public._log_action(
  p_request_id uuid, p_actor public.profiles, p_action text,
  p_from public.request_status, p_to public.request_status,
  p_remarks text, p_visible boolean default true)
returns void language sql security definer set search_path = '' as $$
  insert into public.request_actions
    (request_id, actor_id, actor_name, actor_role, action, from_status, to_status, remarks, visible_to_requester)
  values (p_request_id, p_actor.id, p_actor.full_name, p_actor.role, p_action, p_from, p_to,
          nullif(btrim(p_remarks), ''), coalesce(p_visible, true))
$$;

-- Drop previous overloaded signatures to avoid PostgREST ambiguity
drop function if exists public.pay_disbursement_entry(uuid, numeric, date, text, text, text);
drop function if exists public.pay_disbursement_entry(uuid, numeric, date, text, text, text, text);

-- 3. Update pay_disbursement_entry RPC with optional document & strict mode checks
create or replace function public.pay_disbursement_entry(
  p_entry_id uuid,
  p_amount numeric default null,
  p_payment_date date default null,
  p_payment_mode text default null,
  p_payment_ref text default null,
  p_remarks text default null,
  p_passkey text default null,
  p_document_storage_path text default null,
  p_document_name text default null
)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  me public.profiles;
  person public.disbursement_account_persons;
  e public.disbursement_entries;
  r public.requests;
  v_amt numeric;
  v_approved numeric;
  v_date date;
  v_payment_id uuid;
  v_paid numeric;
  v_full boolean;
  v_entry_paid numeric;
  v_entry_left numeric;
  v_tds_settle numeric := 0;
  v_by text;
  v_clean_mode text;
begin
  me := public._me();
  if me.role <> 'admin' and (me.role <> 'disbursement' or coalesce(me.disbursement_type, 'entry_only') <> 'payment_only') then
    raise exception 'Permission denied: Only Payment-Only or Admin accounts can disburse payments';
  end if;

  if me.role <> 'admin' then
    person := public._verify_account_person(me.id, p_passkey);
  end if;
  v_by := coalesce(person.person_name, me.full_name);

  select * into e from public.disbursement_entries where id = p_entry_id for update;
  if e.id is null then raise exception 'Entry not found'; end if;

  if e.status = 'pending_approval' then
    raise exception 'This entry is awaiting Entry Approver approval before it can be paid';
  end if;
  if e.status = 'rejected' then
    raise exception 'This entry was returned for correction and cannot be paid until corrected and approved';
  end if;
  if e.status <> 'approved' and e.status <> 'pending' then
    raise exception 'This entry is not in an approved payable status (current: %)', e.status;
  end if;

  -- Payment Dealer Mode check (account restriction)
  if me.role <> 'admin' and me.payment_dealer_type is not null and me.payment_dealer_type <> 'both' then
    if me.payment_dealer_type <> e.entry_type then
      raise exception 'Dealer mismatch: This account is a % dealer, but Entry #% is designated as a % entry',
        upper(me.payment_dealer_type), e.entry_no, upper(e.entry_type);
    end if;
  end if;

  -- Strict Entry Mode check:
  -- If entry is cash: mode MUST be Cash.
  -- If entry is bank: mode CANNOT be Cash.
  v_clean_mode := btrim(coalesce(p_payment_mode, case when e.entry_type = 'cash' then 'Cash' else 'Bank Transfer' end));
  if e.entry_type = 'cash' and lower(v_clean_mode) <> 'cash' then
    raise exception 'This entry is defined as Cash payment. Bank modes are not allowed.';
  end if;
  if e.entry_type = 'bank' and lower(v_clean_mode) = 'cash' then
    raise exception 'This entry is defined as Bank transfer. Cash mode is not allowed.';
  end if;

  select * into r from public.requests where id = e.request_id for update;
  if r.id is null or r.request_type in ('discount', 'non_cash', 'stock_transfer') then
    raise exception 'Request not found';
  end if;
  if r.status <> 'approved' then
    raise exception 'Only approved requests can be paid';
  end if;

  -- Only the payment account linked to the entry account may pay
  if me.role <> 'admin' then
    if exists (
      select 1 from public.payment_entry_account_mappings
       where entry_user_id = e.created_by or entry_user_id = r.assigned_entry_user_id
    ) then
      if not exists (
        select 1 from public.payment_entry_account_mappings
         where payment_user_id = me.id
           and (entry_user_id = e.created_by or entry_user_id = r.assigned_entry_user_id)
      ) then
        raise exception 'Routing restriction: Only the payment account specifically linked to this entry account can disburse payment.';
      end if;
    end if;

    if exists (select 1 from public.payment_entry_account_mappings where payment_user_id = me.id) then
      if not exists (
        select 1 from public.payment_entry_account_mappings
         where payment_user_id = me.id
           and (entry_user_id = e.created_by or entry_user_id = r.assigned_entry_user_id)
      ) then
        raise exception 'Routing restriction: This payment account can only pay entries from its assigned entry accounts.';
      end if;
    end if;
  end if;

  -- Exact approved amount only
  v_approved := round(coalesce(e.approved_amount, e.amount - coalesce(e.paid_amount, 0)), 2);
  if v_approved <= 0 then raise exception 'Nothing left to pay on Entry #%', e.entry_no; end if;
  if p_amount is not null and round(p_amount, 2) <> v_approved then
    raise exception 'You can only pay the exact approved amount of ₹% for Entry #% (you entered ₹%)',
      to_char(v_approved, 'FM999999999990.00'), e.entry_no, to_char(round(p_amount, 2), 'FM999999999990.00');
  end if;
  v_amt := v_approved;

  v_date := coalesce(p_payment_date, (now() at time zone 'Asia/Kolkata')::date);
  if v_date > (now() at time zone 'Asia/Kolkata')::date then
    raise exception 'Payment date cannot be in the future';
  end if;

  -- TDS is deducted from the request balance with the entry's first payment
  if coalesce(e.tds_amount, 0) > 0 and not coalesce(e.tds_settled, false) then
    v_tds_settle := e.tds_amount;
    insert into public.request_payments (
      request_id, amount, payment_date, payment_mode, payment_ref, remarks,
      paid_by, paid_by_name, paid_by_person_name, entry_id, is_adjustment
    ) values (
      r.id, v_tds_settle, v_date, 'TDS', null,
      left('TDS deducted · Entry #' || e.entry_no, 500),
      me.id, me.full_name, v_by, e.id, true
    );
  end if;

  insert into public.request_payments (
    request_id, amount, payment_date, payment_mode, payment_ref, remarks,
    paid_by, paid_by_name, paid_by_person_name, entry_id,
    document_storage_path, document_name
  ) values (
    r.id, v_amt, v_date,
    nullif(v_clean_mode, ''),
    nullif(btrim(p_payment_ref), ''),
    nullif(btrim(p_remarks), ''),
    me.id, me.full_name, v_by, e.id,
    nullif(btrim(p_document_storage_path), ''),
    nullif(btrim(p_document_name), '')
  ) returning id into v_payment_id;

  v_entry_paid := round(coalesce(e.paid_amount, 0) + v_amt, 2);
  v_entry_left := round(e.amount - v_entry_paid, 2);

  update public.disbursement_entries set
    paid_amount = v_entry_paid,
    approved_amount = null,
    tds_settled = tds_settled or v_tds_settle > 0,
    paid_at = now(),
    paid_by = me.id,
    paid_by_name = me.full_name,
    paid_by_person_id = person.id,
    paid_by_person_name = person.person_name,
    payment_id = v_payment_id,
    status = case when v_entry_left <= 0 then 'paid' else 'pending_approval' end,
    updated_at = now()
  where id = e.id;

  select coalesce(sum(amount), 0) into v_paid
    from public.request_payments where request_id = r.id;

  v_full := v_paid >= r.amount;

  update public.requests set
    paid_amount = v_paid,
    status = case when v_full then 'paid'::public.request_status else 'approved'::public.request_status end,
    paid_at = case when v_full then now() else paid_at end,
    paid_by = case when v_full then me.id else paid_by end,
    payment_date = case when v_full then v_date else payment_date end,
    payment_mode = coalesce(nullif(v_clean_mode, ''), payment_mode),
    payment_ref = coalesce(nullif(btrim(p_payment_ref), ''), payment_ref),
    payment_remarks = coalesce(nullif(btrim(p_remarks), ''), payment_remarks),
    updated_at = now()
  where id = r.id;

  perform public._log_action(
    r.id, me, 'disbursement_entry_paid',
    'approved'::public.request_status,
    case when v_full then 'paid'::public.request_status else 'approved'::public.request_status end,
    'Entry #' || e.entry_no || ' disbursed by ' || v_by || ': ₹' || to_char(v_amt, 'FM999999999990.00')
      || ' via ' || coalesce(v_clean_mode, upper(coalesce(e.entry_type, 'bank')))
      || case when v_tds_settle > 0 then ' · TDS ₹' || to_char(v_tds_settle, 'FM999999999990.00') || ' deducted from balance' else '' end
      || case when p_payment_ref is not null and btrim(p_payment_ref) <> '' then ' (Ref: ' || btrim(p_payment_ref) || ')' else '' end
      || case when nullif(btrim(p_document_name), '') is not null then ' (doc attached: ' || p_document_name || ')' else '' end
      || case when v_entry_left > 0 then ' · Entry balance ₹' || to_char(v_entry_left, 'FM999999999990.00') || ' sent back for verification' else '' end
      || case when v_full then ' [Fully Paid]' else ' [Request balance: ₹' || to_char(r.amount - v_paid, 'FM999999999990.00') || ']' end,
    true
  );

  if v_full then
    perform public.notify_next_actor(r.id, 'paid');
  elsif v_entry_left > 0 then
    perform public._notify(
      (select array_agg(id) from public.profiles
        where is_active and (role = 'admin' or (role = 'disbursement' and disbursement_type = 'entry_approver'))),
      r.id,
      'Entry #' || e.entry_no || ' balance needs verification',
      coalesce(r.request_no, 'Request') || ': ₹' || to_char(v_amt, 'FM999999999990.00') || ' paid, balance ₹'
        || to_char(v_entry_left, 'FM999999999990.00') || ' awaiting your verification'
    );
  end if;

  return jsonb_build_object(
    'success', true,
    'payment_id', v_payment_id,
    'entry_id', e.id,
    'entry_no', e.entry_no,
    'amount', v_amt,
    'total_paid', v_paid,
    'tds_deducted', v_tds_settle,
    'entry_balance', greatest(v_entry_left, 0),
    'is_fully_paid', v_full,
    'fully_paid', v_full,
    'entry_left', v_entry_left,
    'document_storage_path', p_document_storage_path,
    'document_name', p_document_name
  );
end;
$$;
revoke execute on function public.pay_disbursement_entry(uuid, numeric, date, text, text, text, text, text, text) from public, anon;
grant execute on function public.pay_disbursement_entry(uuid, numeric, date, text, text, text, text, text, text) to authenticated;

notify pgrst, 'reload schema';
