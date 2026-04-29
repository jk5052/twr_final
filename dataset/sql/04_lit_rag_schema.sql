-- ============================================================
-- The White Room — Lit-Passage RAG: lit_rag table
-- Defense-anchored chunks (~1500) extracted from priority clinical PDFs,
-- labeled along defense + 3 axes (metaphor / operation / motif) + VAD,
-- enriched with Empath (Fast 2016) lexical category scores, and embedded
-- with text-embedding-3-large @ 3072d (halfvec).
-- Run in Supabase SQL Editor (project xxdyxtgrnjesbrtalybh).
-- ============================================================

-- (1) table ----------------------------------------------------
create table if not exists public.lit_rag (
  id                bigserial primary key,
  source            text     not null,                  -- PDF stem (e.g. 'WisdomoftheEgo')
  chunk_id          int      not null,                  -- index within source
  text              text     not null,                  -- chunk body
  page_start        int,                                -- optional source span
  page_end          int,
  -- defense labels (Claude)
  primary_defense   text     not null,                  -- one of 28 codebook names
  secondary_defense text,
  vaillant_level    text,                               -- mature|neurotic|immature|psychotic
  reasoning         text,                               -- 1-2 sentences
  quote             text,                               -- short verbatim anchor
  confidence        real,
  applicable        boolean  default true,
  -- 3-axis labels (closed vocab; *_novel hold out-of-vocab proposals)
  metaphors         text[]   not null default '{}',
  operations        text[]   not null default '{}',
  motifs            text[]   not null default '{}',
  metaphors_novel   text[]            default '{}',
  operations_novel  text[]            default '{}',
  motifs_novel      text[]            default '{}',
  -- VAD (NRC convention, [0,1])
  valence           real,
  arousal           real,
  dominance         real,
  -- Empath (194-cat lexicon)
  empath            jsonb,                              -- full {category: score}
  empath_top        text[]            default '{}',     -- top-K category names
  -- embedding
  embedding         halfvec(3072) not null,
  created_at        timestamptz default now(),
  unique (source, chunk_id)
);

comment on table public.lit_rag is
  'Defense-anchored clinical-literature chunks for ensemble RAG (Stream A/B). 28-defense + 3-axis (metaphor/operation/motif) + VAD + Empath, halfvec(3072) embedding.';

-- (2) indexes --------------------------------------------------
create index if not exists lit_rag_primary_defense_idx
  on public.lit_rag (primary_defense)   where applicable = true;
create index if not exists lit_rag_secondary_defense_idx
  on public.lit_rag (secondary_defense) where applicable = true;
create index if not exists lit_rag_vaillant_idx
  on public.lit_rag (vaillant_level)    where applicable = true;
create index if not exists lit_rag_source_idx
  on public.lit_rag (source);
create index if not exists lit_rag_applicable_idx
  on public.lit_rag (applicable);

-- 3-axis array filters: GIN supports overlap (&&) / contains (@>).
create index if not exists lit_rag_metaphors_gin
  on public.lit_rag using gin (metaphors);
create index if not exists lit_rag_operations_gin
  on public.lit_rag using gin (operations);
create index if not exists lit_rag_motifs_gin
  on public.lit_rag using gin (motifs);
create index if not exists lit_rag_empath_top_gin
  on public.lit_rag using gin (empath_top);

-- HNSW on halfvec embedding (cosine).
create index if not exists lit_rag_embedding_hnsw
  on public.lit_rag
  using hnsw (embedding halfvec_cosine_ops);

-- (3) match_lit RPC -------------------------------------------
drop function if exists public.match_lit(halfvec, float, int);
drop function if exists public.match_lit(halfvec, float, int, text, text);
drop function if exists public.match_lit(halfvec, float, int, text, text,
  text[], text[], text[], text[], real, boolean);

create or replace function public.match_lit(
  query_embedding   halfvec(3072),
  match_threshold   float    default 0.0,
  match_count       int      default 8,
  defense_filter    text     default null,   -- checks primary OR secondary
  vaillant_filter   text     default null,   -- mature|neurotic|immature|psychotic
  metaphor_filter   text[]   default null,   -- chunk.metaphors  && filter
  operation_filter  text[]   default null,   -- chunk.operations && filter
  motif_filter      text[]   default null,   -- chunk.motifs     && filter
  empath_filter     text[]   default null,   -- chunk.empath_top && filter
  min_confidence    real     default null,
  applicable_only   boolean  default true
)
returns table (
  id                bigint,
  source            text,
  chunk_id          int,
  text              text,
  primary_defense   text,
  secondary_defense text,
  vaillant_level    text,
  metaphors         text[],
  operations        text[],
  motifs            text[],
  valence           real,
  arousal           real,
  dominance         real,
  empath_top        text[],
  quote             text,
  confidence        real,
  similarity        float
)
language sql stable
as $$
  select
    l.id, l.source, l.chunk_id, l.text,
    l.primary_defense, l.secondary_defense, l.vaillant_level,
    l.metaphors, l.operations, l.motifs,
    l.valence, l.arousal, l.dominance,
    l.empath_top, l.quote, l.confidence,
    1 - (l.embedding <=> query_embedding) as similarity
  from public.lit_rag l
  where (not applicable_only or l.applicable = true)
    and (defense_filter   is null
         or l.primary_defense   = defense_filter
         or l.secondary_defense = defense_filter)
    and (vaillant_filter  is null or l.vaillant_level = vaillant_filter)
    and (metaphor_filter  is null or l.metaphors  && metaphor_filter)
    and (operation_filter is null or l.operations && operation_filter)
    and (motif_filter     is null or l.motifs     && motif_filter)
    and (empath_filter    is null or l.empath_top && empath_filter)
    and (min_confidence   is null or l.confidence >= min_confidence)
    and 1 - (l.embedding <=> query_embedding) > match_threshold
  order by l.embedding <=> query_embedding
  limit match_count;
$$;

-- (4) verification --------------------------------------------
-- after migration / first upload:
--   select source, count(*) from public.lit_rag group by 1 order by 2 desc;
--   select primary_defense, count(*) from public.lit_rag
--     where applicable group by 1 order by 2 desc;
--   select unnest(metaphors) m, count(*) from public.lit_rag group by 1 order by 2 desc;
--   select unnest(empath_top) c, count(*) from public.lit_rag group by 1 order by 2 desc;
--   select routine_name from information_schema.routines
--    where routine_schema = 'public' and routine_name = 'match_lit';
