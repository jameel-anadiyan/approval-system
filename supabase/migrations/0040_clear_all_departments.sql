-- ============================================================================
-- 0040_clear_all_departments.sql
-- CLEAR ALL DEPARTMENTS AND RELATED DEPENDENCIES FOR PRODUCTION GO-LIVE
-- ============================================================================

do $$
begin
  -- 1. Clear any requests and consultations referencing departments
  delete from public.request_files;
  delete from public.signed_files;
  delete from public.request_actions;
  delete from public.request_payments;
  delete from public.head_consultations;
  delete from public.disbursement_clarifications;
  delete from public.notifications;
  delete from public.requests;

  -- 2. Clear work categories and clerk category mappings
  delete from public.clerk_categories;
  delete from public.work_categories;

  -- 3. Clear any non-admin staff associated with departments
  delete from public.user_heads;
  delete from public.regional_head_shops;
  delete from public.approver_credentials where user_id not in (select id from public.profiles where role = 'admin');

  delete from auth.users where id in (select id from public.profiles where department_id is not null);
  delete from public.profiles where department_id is not null;

  -- 4. Clear all departments
  delete from public.departments;

end $$;

notify pgrst, 'reload schema';
