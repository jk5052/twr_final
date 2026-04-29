-- ============================================================
-- The White Room — add oracle/poem references to cards
--   oracle_stimulus_id : id of the stimuli_rag row chosen as the user-facing
--                        movie-scenario question (output c).
--   poem_id            : id of the poems_rag row chosen as the matched poem
--                        (output b). Filled when poems_rag content is ready.
-- Run in Supabase SQL Editor.
-- ============================================================

alter table public.cards
  add column if not exists oracle_stimulus_id bigint,
  add column if not exists poem_id            bigint;

comment on column public.cards.oracle_stimulus_id is
  'FK-like reference to stimuli_rag.id. Selection policy: uniform random within stimuli where defense = top_defense, with fallback to top_2 / top_3 if pool < 3.';
comment on column public.cards.poem_id is
  'FK-like reference to poems_rag.id. Filled by the (b) poem-match output layer.';

create index if not exists cards_oracle_stimulus_idx
  on public.cards (oracle_stimulus_id) where oracle_stimulus_id is not null;
create index if not exists cards_poem_idx
  on public.cards (poem_id) where poem_id is not null;
