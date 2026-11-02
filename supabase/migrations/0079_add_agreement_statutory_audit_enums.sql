-- ============================================================================
-- 0079_add_agreement_statutory_audit_enums.sql
-- Adds 'agreement', 'statutory_payment', and 'audit_report' to public.request_type.
-- ============================================================================

alter type public.request_type add value if not exists 'agreement';
alter type public.request_type add value if not exists 'statutory_payment';
alter type public.request_type add value if not exists 'audit_report';
