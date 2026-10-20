-- Regional Head role + "waiting for Regional Head" status.
-- Enum values must be committed before any function/policy uses them, so this
-- migration is applied on its own before 0026.
alter type public.app_role add value if not exists 'regional_head';
alter type public.request_status add value if not exists 'pending_regional_review' after 'submitted';
