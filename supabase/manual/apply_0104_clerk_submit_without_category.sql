-- ============================================================================
-- apply_0104: Clerk can submit their own request without a work category
-- ----------------------------------------------------------------------------
-- Symptom: a Clerk's own draft fails on submit with
--   "Please select a work category before submitting"
-- but the app never shows the work-category picker to Clerks (a clerk's own
-- request goes straight to their Head; work categories only decide which clerk
-- handles an employee's request).
--
-- Fix: patch ONLY that one check inside the live public.submit_request so that
-- Clerks are exempt, exactly like Heads and Admins. Everything else in the live
-- function stays untouched.
--
-- Run this whole file in Supabase Dashboard -> SQL Editor. Safe to re-run.
-- ============================================================================

do $$
declare
  v_oid oid;
  v_def text;
  v_new text;
begin
  for v_oid in
    select p.oid from pg_proc p join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'public' and p.proname = 'submit_request'
  loop
    v_def := pg_get_functiondef(v_oid);
    v_new := regexp_replace(
      v_def,
      $re$me\.role not in \('head', 'admin'\) and r\.category_id is null$re$,
      $rp$me.role not in ('head', 'admin', 'clerk') and r.category_id is null$rp$,
      'g');
    if v_new <> v_def then
      execute v_new;
      raise notice 'submit_request (oid %) patched: clerks no longer need a work category', v_oid;
    else
      raise notice 'submit_request (oid %) already patched or pattern not found', v_oid;
    end if;
  end loop;
end $$;

-- Check: must return ok = true
select 'submit_request lets Clerk submit without work category' as check_name,
       exists (select 1 from pg_proc p join pg_namespace n on n.oid = p.pronamespace
               where n.nspname = 'public' and p.proname = 'submit_request'
                 and pg_get_functiondef(p.oid) ilike '%not in (''head'', ''admin'', ''clerk'') and r.category_id is null%')
       and not exists (select 1 from pg_proc p join pg_namespace n on n.oid = p.pronamespace
               where n.nspname = 'public' and p.proname = 'submit_request'
                 and pg_get_functiondef(p.oid) ilike '%not in (''head'', ''admin'') and r.category_id is null%') as ok;
