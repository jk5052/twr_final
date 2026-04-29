-- ============================================================
-- The White Room — RAG1 Phase A: items_rag table
-- DSQ-60 (60 items) + DMRS-SR-30 (30 items) = 90 self-report items,
-- each labeled with one of 28 codebook defenses + halfvec(3072) embedding.
-- Run in Supabase SQL Editor (project xxdyxtgrnjesbrtalybh).
-- Requires extensions: pgvector (halfvec available since 0.7.0).
-- ============================================================

-- (1) table ----------------------------------------------------
create table if not exists public.items_rag (
  id                bigserial primary key,
  source            text     not null,                  -- 'DSQ-60' | 'DMRS-SR-30'
  item_id           int      not null,                  -- numbering inside source
  text              text     not null,                  -- cleaned English item text
  raw_text          text,                               -- pre-cleaning (for audit)
  primary_defense   text     not null,                  -- one of 28 codebook names
  secondary_defense text,                               -- nullable
  reasoning         text,                               -- 1-2 sentence rationale (Claude)
  embedding         halfvec(3072) not null,             -- text-embedding-3-large 3072d
  created_at        timestamptz default now(),
  unique (source, item_id)
);

comment on table public.items_rag is
  'Clinical self-report inventory items (DSQ-60 + DMRS-SR-30) anchored to 28 defense mechanisms for RAG1 Method A.';

-- (2) indexes --------------------------------------------------
create index if not exists items_rag_primary_defense_idx
  on public.items_rag (primary_defense);
create index if not exists items_rag_secondary_defense_idx
  on public.items_rag (secondary_defense);
create index if not exists items_rag_source_idx
  on public.items_rag (source);

-- ANN index on the halfvec embedding (cosine distance).
-- 90 rows is small; HNSW still gives stable < 10ms query.
create index if not exists items_rag_embedding_hnsw
  on public.items_rag
  using hnsw (embedding halfvec_cosine_ops);

-- (3) match_items RPC -----------------------------------------
drop function if exists public.match_items(halfvec, float, int);
drop function if exists public.match_items(halfvec, float, int, text, text);

create or replace function public.match_items(
  query_embedding   halfvec(3072),
  match_threshold   float default 0.0,
  match_count       int   default 5,
  defense_filter    text  default null,   -- exact codebook name; checks primary OR secondary
  source_filter     text  default null    -- 'DSQ-60' | 'DMRS-SR-30' | null=both
)
returns table (
  id                bigint,
  source            text,
  item_id           int,
  text              text,
  primary_defense   text,
  secondary_defense text,
  reasoning         text,
  similarity        float
)
language sql stable
as $$
  select
    i.id,
    i.source,
    i.item_id,
    i.text,
    i.primary_defense,
    i.secondary_defense,
    i.reasoning,
    1 - (i.embedding <=> query_embedding) as similarity
  from public.items_rag i
  where (defense_filter is null
         or i.primary_defense   = defense_filter
         or i.secondary_defense = defense_filter)
    and (source_filter  is null or i.source = source_filter)
    and 1 - (i.embedding <=> query_embedding) > match_threshold
  order by i.embedding <=> query_embedding
  limit match_count;
$$;

-- (4) verification --------------------------------------------
-- after migration:
--   select source, count(*) from public.items_rag group by 1;        -- expect DSQ-60=60, DMRS-SR-30=30
--   select primary_defense, count(*) from public.items_rag group by 1 order by 2 desc;
--   select routine_name from information_schema.routines
--    where routine_schema = 'public' and routine_name = 'match_items';
