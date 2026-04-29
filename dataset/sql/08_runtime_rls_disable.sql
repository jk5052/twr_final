-- ============================================================
-- The White Room — runtime RLS disable (PROTOTYPING ONLY)
-- Anonymous browser clients (NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY) need to
-- insert/select on narrative_logs and cards while we iterate. Tighten before
-- public deploy: enable RLS + add session-scoped policies.
-- Run in Supabase SQL Editor (project xxdyxtgrnjesbrtalybh).
-- ============================================================

alter table public.narrative_logs disable row level security;
alter table public.cards          disable row level security;

-- read-only sources used by the browser (preload of choices_rag for label snapshot)
-- We don't write from browser; allow select with RLS off for prototyping.
alter table public.choices_rag    disable row level security;

-- verification
--   select relname, relrowsecurity from pg_class
--    where relname in ('narrative_logs','cards','choices_rag');
--   -- relrowsecurity should be 'f' for all three.
