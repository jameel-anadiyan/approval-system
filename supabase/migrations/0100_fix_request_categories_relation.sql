-- ============================================================================
-- Migration 0100: Fix missing relation public.request_categories
--
-- In submit_request, queries referenced public.request_categories instead of
-- the underlying table public.work_categories.
-- We create public.request_categories as a view pointing to public.work_categories
-- so any reference resolves seamlessly.
-- ============================================================================

create or replace view public.request_categories as
  select * from public.work_categories;

grant select on public.request_categories to authenticated;
grant select on public.request_categories to anon;

comment on view public.request_categories is
  'View over public.work_categories for backwards-compatibility with request submission functions';

