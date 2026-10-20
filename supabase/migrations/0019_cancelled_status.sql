-- 0019_cancelled_status.sql
-- New terminal status: an approved request cancelled by its owner Head before it was fully paid.
-- Kept in its own migration: a new enum value cannot be used in the same transaction that adds it.

alter type public.request_status add value if not exists 'cancelled';
