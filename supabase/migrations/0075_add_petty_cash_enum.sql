-- ============================================================================
-- 0075_add_petty_cash_enum.sql
-- Adds 'petty_cash' to public.request_type enum in its own migration step.
-- ============================================================================

alter type public.request_type add value if not exists 'petty_cash';
