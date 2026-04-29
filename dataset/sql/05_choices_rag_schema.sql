-- ============================================================
-- The White Room — Stream B: choices_rag table
-- 200 in-game player choices (ITEMS + ROOM_ENTRY_EVENTS) labeled with
-- defense weights + 3 axes (metaphor / operation / motif) + VAD + Empath,
-- embedded on (prompt || ' ' || label) with text-embedding-3-large @ 3072d.
-- Run in Supabase SQL Editor (project xxdyxtgrnjesbrtalybh).
-- ============================================================

-- (1) table ----------------------------------------------------
create table if not exists public.choices_rag (
  id                bigserial primary key,
  source            text     not null,                  -- 'ITEMS' | 'ROOM_ENTRY_EVENTS'
  room              int      not null,
  item_id           text     not null,                  -- GLB mesh name or 'room_entry'
  event_index       int      not null,
  choice_index      int      not null,
  -- raw game content (mirrors twr/data/events.ts)
  prompt            text     not null,
  label             text     not null,
  tag               text     not null,                  -- 5-tag UX (AV|EX|CG|SP|AD)
  end_chain         boolean  default false,
  card_id           text,
  -- defense labels (Claude)
  primary_defense   text     not null,
  secondary_defense text,
  vaillant_level    text,
  defense_weights   jsonb    not null default '[]',     -- [{defense, weight}], sums to 1
  reasoning         text,
  confidence        real,
  applicable        boolean  default true,
  -- 3-axis labels
  metaphors         text[]   not null default '{}',
  operations        text[]   not null default '{}',
  motifs            text[]   not null default '{}',
  metaphors_novel   text[]            default '{}',
  operations_novel  text[]            default '{}',
  motifs_novel      text[]            default '{}',
  -- VAD
  valence           real,
  arousal           real,
  dominance         real,
  -- Empath
  empath            jsonb,
  empath_top        text[]            default '{}',
  -- embedding
  embedding         halfvec(3072) not null,
  created_at        timestamptz default now(),
  unique (room, item_id, event_index, choice_index)
);

comment on table public.choices_rag is
  'In-game player choices (Stream B) for ensemble RAG. Defense-weighted + 3-axis (metaphor/operation/motif) + VAD + Empath, halfvec(3072) embedding on (prompt || label).';

-- (2) indexes --------------------------------------------------
create index if not exists choices_rag_primary_defense_idx
  on public.choices_rag (primary_defense)   where applicable = true;
create index if not exists choices_rag_secondary_defense_idx
  on public.choices_rag (secondary_defense) where applicable = true;
create index if not exists choices_rag_vaillant_idx
  on public.choices_rag (vaillant_level)    where applicable = true;
create index if not exists choices_rag_room_idx
  on public.choices_rag (room);
create index if not exists choices_rag_tag_idx
  on public.choices_rag (tag);
create index if not exists choices_rag_applicable_idx
  on public.choices_rag (applicable);

create index if not exists choices_rag_metaphors_gin
  on public.choices_rag using gin (metaphors);
create index if not exists choices_rag_operations_gin
  on public.choices_rag using gin (operations);
create index if not exists choices_rag_motifs_gin
  on public.choices_rag using gin (motifs);
create index if not exists choices_rag_empath_top_gin
  on public.choices_rag using gin (empath_top);

create index if not exists choices_rag_embedding_hnsw
  on public.choices_rag
  using hnsw (embedding halfvec_cosine_ops);

-- (3) match_choices RPC ---------------------------------------
drop function if exists public.match_choices(halfvec, float, int);
drop function if exists public.match_choices(halfvec, float, int, text, text);
drop function if exists public.match_choices(halfvec, float, int, text, text,
  text[], text[], text[], text[], int, text, real, boolean);

create or replace function public.match_choices(
  query_embedding   halfvec(3072),
  match_threshold   float    default 0.0,
  match_count       int      default 8,
  defense_filter    text     default null,   -- primary OR secondary
  vaillant_filter   text     default null,
  metaphor_filter   text[]   default null,
  operation_filter  text[]   default null,
  motif_filter      text[]   default null,
  empath_filter     text[]   default null,
  room_filter       int      default null,
  tag_filter        text     default null,
  min_confidence    real     default null,
  applicable_only   boolean  default true
)
returns table (
  id                bigint,
  source            text,
  room              int,
  item_id           text,
  event_index       int,
  choice_index      int,
  prompt            text,
  label             text,
  tag               text,
  primary_defense   text,
  secondary_defense text,
  vaillant_level    text,
  defense_weights   jsonb,
  metaphors         text[],
  operations        text[],
  motifs            text[],
  valence           real,
  arousal           real,
  dominance         real,
  empath_top        text[],
  confidence        real,
  similarity        float
)
language sql stable
as $$
  select
    c.id, c.source, c.room, c.item_id, c.event_index, c.choice_index,
    c.prompt, c.label, c.tag,
    c.primary_defense, c.secondary_defense, c.vaillant_level, c.defense_weights,
    c.metaphors, c.operations, c.motifs,
    c.valence, c.arousal, c.dominance,
    c.empath_top, c.confidence,
    1 - (c.embedding <=> query_embedding) as similarity
  from public.choices_rag c
  where (not applicable_only or c.applicable = true)
    and (defense_filter   is null
         or c.primary_defense   = defense_filter
         or c.secondary_defense = defense_filter)
    and (vaillant_filter  is null or c.vaillant_level = vaillant_filter)
    and (metaphor_filter  is null or c.metaphors  && metaphor_filter)
    and (operation_filter is null or c.operations && operation_filter)
    and (motif_filter     is null or c.motifs     && motif_filter)
    and (empath_filter    is null or c.empath_top && empath_filter)
    and (room_filter      is null or c.room       = room_filter)
    and (tag_filter       is null or c.tag        = tag_filter)
    and (min_confidence   is null or c.confidence >= min_confidence)
    and 1 - (c.embedding <=> query_embedding) > match_threshold
  order by c.embedding <=> query_embedding
  limit match_count;
$$;
