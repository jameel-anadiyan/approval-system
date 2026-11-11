-- ============================================================================
-- MANUAL MIGRATION 0100: Fix missing relation public.request_categories
--
-- Fixes error:
-- "relation public.request_categories does not exist"
-- when submitting a draft request.
--
-- Instructions:
-- 1. Copy and paste the entire content of this file into the Supabase SQL Editor.
-- 2. Click "Run".
-- 3. In the app, click "Submit for Approval" on the draft request.
-- ============================================================================

create or replace view public.request_categories as
  select * from public.work_categories;

grant select on public.request_categories to authenticated;
grant select on public.request_categories to anon;

comment on view public.request_categories is
  'View over public.work_categories for backwards-compatibility with request submission functions';

do $$
begin
  raise notice 'SUCCESS: public.request_categories view created successfully.';
end $$;

