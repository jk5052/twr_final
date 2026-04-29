-- ============================================================
-- The White Room — Phase 3: tag-aware poems_rag
-- Run in Supabase SQL Editor (project xxdyxtgrnjesbrtalybh)
-- ============================================================

-- (1) add tag columns -----------------------------------------
alter table public.poems_rag
  add column if not exists primary_defense   text,
  add column if not exists secondary_defense text,
  add column if not exists intensity         smallint,
  add column if not exists stance            text,
  add column if not exists evidence          text,
  add column if not exists confidence        real,
  add column if not exists applicable        boolean default true,
  add column if not exists word_count        integer;

-- stance enumerated values (no enum type — keep flexible)
alter table public.poems_rag
  drop constraint if exists poems_rag_stance_chk;
alter table public.poems_rag
  add  constraint poems_rag_stance_chk
       check (stance is null or stance in ('confession','address','observation','meditation'));

-- (2) filterable indexes --------------------------------------
create index if not exists poems_rag_primary_defense_idx
  on public.poems_rag (primary_defense)   where applicable = true;
create index if not exists poems_rag_secondary_defense_idx
  on public.poems_rag (secondary_defense) where applicable = true;
create index if not exists poems_rag_stance_idx
  on public.poems_rag (stance)            where applicable = true;
create index if not exists poems_rag_intensity_idx
  on public.poems_rag (intensity)         where applicable = true;
create index if not exists poems_rag_applicable_idx
  on public.poems_rag (applicable);

-- (3) replace match_poems with tag-aware version --------------
drop function if exists public.match_poems(halfvec, float, int);
drop function if exists public.match_poems(halfvec, float, int, text, text, smallint);

create or replace function public.match_poems(
  query_embedding   halfvec(3072),
  match_threshold   float    default 0.0,
  match_count       int      default 5,
  defense_filter    text     default null,   -- exact name; checks primary OR secondary
  stance_filter     text     default null,   -- one of confession/address/observation/meditation
  min_intensity     smallint default null,
  applicable_only   boolean  default true
)
returns table (
  id                bigint,
  poem_name         text,
  author            text,
  content           text,
  primary_defense   text,
  secondary_defense text,
  intensity         smallint,
  stance            text,
  evidence          text,
  confidence        real,
  similarity        float
)
language sql stable
as $$
  select
    p.id,
    p.poem_name,
    p.author,
    p.content,
    p.primary_defense,
    p.secondary_defense,
    p.intensity,
    p.stance,
    p.evidence,
    p.confidence,
    1 - (p.embedding <=> query_embedding) as similarity
  from public.poems_rag p
  where (not applicable_only or p.applicable = true)
    and (defense_filter is null
         or p.primary_defense   = defense_filter
         or p.secondary_defense = defense_filter)
    and (stance_filter  is null or p.stance     = stance_filter)
    and (min_intensity  is null or p.intensity >= min_intensity)
    and 1 - (p.embedding <=> query_embedding) > match_threshold
  order by p.embedding <=> query_embedding
  limit match_count;
$$;

-- (4) verification --------------------------------------------
-- run after the migration:
-- select column_name, data_type
--   from information_schema.columns
--  where table_name = 'poems_rag'
--  order by ordinal_position;
--
-- select routine_name, parameter_name, data_type
--   from information_schema.routines r
--   left join information_schema.parameters p on p.specific_name = r.specific_name
--  where routine_schema = 'public' and routine_name = 'match_poems'
--  order by p.ordinal_position;
