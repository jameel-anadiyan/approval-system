-- Migration 0028: Add non_cash to request_type enum
-- Must be committed before any function/policy references the new enum value.
alter type public.request_type add value if not exists 'non_cash';
