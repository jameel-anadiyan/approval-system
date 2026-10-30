-- Migration 0067: Add bank account verification and disbursement mode to requests
-- Supports Penny-Less bank verification, Cash vs Bank mode, and editing until first payment release

-- 1. Add bank account columns to requests table ---------------------------------
alter table public.requests
  add column if not exists disbursement_mode text default 'cash',
  add column if not exists enter_bank_details_later boolean default false,
  add column if not exists bank_account_no text,
  add column if not exists bank_ifsc text,
  add column if not exists bank_name text,
  add column if not exists bank_branch text,
  add column if not exists bank_account_holder_name text,
  add column if not exists bank_verified boolean default false,
  add column if not exists bank_verification_message text;

-- Add check constraint for disbursement_mode if not present
do $$
begin
  if not exists (
    select 1 from pg_constraint where conname = 'requests_disbursement_mode_check'
  ) then
    alter table public.requests
      add constraint requests_disbursement_mode_check
      check (disbursement_mode is null or disbursement_mode in ('cash', 'bank'));
  end if;
end $$;

-- 2. Function to update request bank details -----------------------------------
-- Allowed for: regional_head, clerk, head, admin, entry_only disbursement officer,
-- or requester on draft/returned requests — strictly until the first payment is released.
create or replace function public.update_request_bank_details(
  p_request_id uuid,
  p_disbursement_mode text,
  p_enter_bank_details_later boolean default false,
  p_bank_account_no text default null,
  p_bank_ifsc text default null,
  p_bank_name text default null,
  p_bank_branch text default null,
  p_bank_account_holder_name text default null,
  p_bank_verified boolean default false,
  p_bank_verification_message text default null
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_user_id uuid := auth.uid();
  v_profile public.profiles%rowtype;
  v_req public.requests%rowtype;
  v_is_first_payment_released boolean := false;
  v_can_edit boolean := false;
begin
  select * into v_req from public.requests where id = p_request_id for update;
  if not found then
    return jsonb_build_object('success', false, 'error', 'Request not found');
  end if;

  -- Check if first payment has already been released
  v_is_first_payment_released := (
    coalesce(v_req.paid_amount, 0) > 0 or
    v_req.status = 'paid' or
    exists (
      select 1 from public.disbursement_entries
      where request_id = p_request_id and coalesce(paid_amount, 0) > 0
    ) or
    exists (
      select 1 from public.request_payments
      where request_id = p_request_id
    )
  );

  if v_is_first_payment_released then
    return jsonb_build_object(
      'success', false,
      'error', 'Bank details cannot be modified after the first payment has been released.'
    );
  end if;

  select * into v_profile from public.profiles where id = v_user_id;

  -- Verify authorized roles: regional_head, clerk, head, admin, entry_only disbursement officer
  if v_profile.role in ('admin', 'head', 'clerk', 'regional_head') then
    v_can_edit := true;
  elsif v_profile.role = 'disbursement' and (v_profile.disbursement_type = 'entry_only' or v_profile.disbursement_type is null) then
    v_can_edit := true;
  elsif v_req.requester_id = v_user_id and v_req.status in ('draft', 'returned') then
    v_can_edit := true;
  end if;

  if not v_can_edit then
    return jsonb_build_object(
      'success', false,
      'error', 'You do not have permission to edit bank details for this request.'
    );
  end if;

  -- Update columns and sync into details jsonb
  update public.requests
  set
    disbursement_mode = coalesce(p_disbursement_mode, 'cash'),
    enter_bank_details_later = coalesce(p_enter_bank_details_later, false),
    bank_account_no = p_bank_account_no,
    bank_ifsc = p_bank_ifsc,
    bank_name = p_bank_name,
    bank_branch = p_bank_branch,
    bank_account_holder_name = p_bank_account_holder_name,
    bank_verified = coalesce(p_bank_verified, false),
    bank_verification_message = p_bank_verification_message,
    details = coalesce(details, '{}'::jsonb) || jsonb_build_object(
      'disbursement_mode', coalesce(p_disbursement_mode, 'cash'),
      'enter_bank_details_later', coalesce(p_enter_bank_details_later, false),
      'bank_account_no', p_bank_account_no,
      'bank_ifsc', p_bank_ifsc,
      'bank_name', p_bank_name,
      'bank_branch', p_bank_branch,
      'bank_account_holder_name', p_bank_account_holder_name,
      'bank_verified', coalesce(p_bank_verified, false),
      'bank_verification_message', p_bank_verification_message
    ),
    updated_at = now()
  where id = p_request_id;

  return jsonb_build_object('success', true);
end;
$$;

grant execute on function public.update_request_bank_details to authenticated, anon;
