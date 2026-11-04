-- Quick fix for "disbursement_entries_adjustment_check" error
-- Run this in your Supabase SQL Editor:

-- 1. Drop any old or restrictive adjustment / amount constraints
do $$
declare
  c record;
begin
  for c in
    select conname
      from pg_constraint
     where conrelid = 'public.disbursement_entries'::regclass
       and contype = 'c'
       and (conname ilike '%adjustment%' or conname ilike '%amount%')
       and conname not in ('disbursement_entries_tds_amount_check')
  loop
    execute 'alter table public.disbursement_entries drop constraint if exists ' || quote_ident(c.conname);
  end loop;
end $$;

alter table public.disbursement_entries drop constraint if exists disbursement_entries_adjustment_check;
alter table public.disbursement_entries drop constraint if exists disbursement_entries_adjustment_amount_check;
alter table public.disbursement_entries drop constraint if exists disbursement_entries_amount_check;
alter table public.disbursement_entries drop constraint if exists disbursement_entries_amounts_check;

-- 2. Add the safe check allowing amount = 0 when adjustment_amount > 0
alter table public.disbursement_entries
  add constraint disbursement_entries_amounts_check
  check (amount >= 0 and coalesce(adjustment_amount, 0) >= 0 and (amount + coalesce(adjustment_amount, 0)) > 0);

-- 3. Ensure entry_type allows 'old_balance'
alter table public.disbursement_entries drop constraint if exists disbursement_entries_entry_type_check;
alter table public.disbursement_entries
  add constraint disbursement_entries_entry_type_check
  check (entry_type in ('cash', 'bank', 'old_balance'));

notify pgrst, 'reload schema';
