-- ============================================================================
-- 0059_add_updated_at_to_disbursement_entries.sql
--
-- Fix: "column updated_at of relation disbursement_entries does not exist"
-- when resubmitting a rejected disbursement entry.
--
-- Why the problem occurred:
-- In migration 0051, RPC `edit_rejected_disbursement_entry` set:
--   updated_at = now()
-- on `public.disbursement_entries`, but the `updated_at` column was never added
-- to `public.disbursement_entries` in table creation or alter table statements.
--
-- This migration adds the missing `updated_at` column to `public.disbursement_entries`
-- and updates `edit_rejected_disbursement_entry` with approver notifications.
-- ============================================================================

-- 1. Add missing updated_at column to disbursement_entries table
alter table public.disbursement_entries
  add column if not exists updated_at timestamptz not null default now();

-- 2. Update edit_rejected_disbursement_entry to work seamlessly and notify Entry Approvers
create or replace function public.edit_rejected_disbursement_entry(
  p_entry_id uuid,
  p_amount numeric,
  p_entry_type text,
  p_tds_cut boolean default false,
  p_notes text default null,
  p_adjustment numeric default 0
)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  me public.profiles;
  e public.disbursement_entries;
  r public.requests;
  v_amt numeric;
  v_adj numeric;
  v_type text;
  v_other_entries_sum numeric;
  v_available numeric;
  v_notes text := nullif(btrim(p_notes), '');
begin
  me := public._me();
  select * into e from public.disbursement_entries where id = p_entry_id for update;
  if e.id is null then raise exception 'Entry not found'; end if;

  -- Strictly only allowed when status is 'rejected'
  if e.status <> 'rejected' then
    raise exception 'Only rejected entries can be edited. Current status is %', e.status;
  end if;

  -- Permission: creator or admin
  if me.role <> 'admin' and (me.id is distinct from e.created_by) then
    raise exception 'Permission denied: Only the entry officer who created this entry can edit it';
  end if;

  select * into r from public.requests where id = e.request_id for update;
  if r.status <> 'approved' then raise exception 'Request is no longer waiting for payment'; end if;

  v_type := coalesce(lower(btrim(p_entry_type)), e.entry_type, 'bank');
  if v_type not in ('cash', 'bank') then
    raise exception 'Entry mode must be either cash or bank';
  end if;

  v_amt := round(coalesce(p_amount, 0), 2);
  v_adj := round(coalesce(p_adjustment, 0), 2);
  if v_amt < 0 then raise exception 'Entry amount cannot be negative'; end if;
  if v_adj < 0 then raise exception 'Adjustment amount cannot be negative'; end if;
  if v_amt + v_adj <= 0 then raise exception 'Enter an entry amount or adjustment'; end if;

  -- Check remaining balance excluding this entry
  select coalesce(sum(amount), 0) into v_other_entries_sum
    from public.disbursement_entries
   where request_id = r.id and id <> e.id and status in ('pending', 'pending_approval', 'approved');

  v_available := round(r.amount - coalesce(r.paid_amount, 0) - v_other_entries_sum, 2);
  if v_amt + v_adj > v_available then
    raise exception 'Corrected amount ₹% exceeds balance available (₹%)', v_amt + v_adj, v_available;
  end if;

  update public.disbursement_entries set
    amount = v_amt,
    entry_type = v_type,
    tds_cut = coalesce(p_tds_cut, false),
    notes = v_notes,
    adjustment_amount = v_adj,
    status = 'pending_approval',
    rejection_reason = null,
    rejected_by = null,
    rejected_by_name = null,
    rejected_at = null,
    updated_at = now()
  where id = e.id;

  perform public._log_action(
    r.id, me, 'disbursement_entry_corrected', r.status, r.status,
    'Entry #' || e.entry_no || ' corrected & resubmitted: ₹' || to_char(v_amt, 'FM999999999990.00')
      || ' (' || upper(v_type) || ') '
      || case when coalesce(p_tds_cut, false) then ' (TDS Cut)' else ' (TDS Not Cut)' end
      || ' (Pending Approver sign-off)',
    true
  );

  -- Notify Entry Approvers that corrected entry is waiting for verification
  perform public._notify(
    (
      select array_agg(id)
      from public.profiles
      where is_active and (role = 'admin' or (role = 'disbursement' and disbursement_type = 'entry_approver'))
    ),
    r.id,
    'Entry #' || e.entry_no || ' corrected & resubmitted',
    coalesce(r.request_no, 'Request') || ': ₹' || to_char(v_amt, 'FM999999999990.00') || ' (' || upper(v_type) || ') pending verification'
  );

  return jsonb_build_object(
    'success', true,
    'entry_id', e.id,
    'entry_no', e.entry_no,
    'amount', v_amt,
    'entry_type', v_type,
    'status', 'pending_approval'
  );
end $$;

revoke execute on function public.edit_rejected_disbursement_entry(uuid, numeric, text, boolean, text, numeric) from public, anon;
grant execute on function public.edit_rejected_disbursement_entry(uuid, numeric, text, boolean, text, numeric) to authenticated;

notify pgrst, 'reload schema';
