-- ============================================================
-- The White Room — runtime tables
--   narrative_logs : per-choice event log during play (denormalized choice labels)
--   cards          : end-of-session ensemble result (28-D defense distribution + evidence)
-- Schema mirrors the Python ensemble_retrieve.py output JSON exactly so client
-- code can upsert the dict body without reshaping.
-- Run in Supabase SQL Editor (project xxdyxtgrnjesbrtalybh).
-- ============================================================

-- (1) narrative_logs ---------------------------------------------
create table if not exists public.narrative_logs (
  id                bigserial primary key,
  session_id        uuid     not null,
  player_id         text,                                       -- nullable for anonymous play
  -- choice locator (matches choices_rag composite key)
  room              int      not null,
  item_id           text     not null,
  event_index       int      not null,
  choice_index      int      not null,
  -- denormalized choice content (snapshot at time of play)
  prompt            text     not null,
  label             text     not null,
  tag               text     not null,
  end_chain         boolean  default false,
  -- snapshot of choice labels (joined from choices_rag at insert time)
  primary_defense   text,
  secondary_defense text,
  defense_weights   jsonb,
  vaillant_level    text,
  metaphors         text[]   default '{}',
  operations        text[]   default '{}',
  motifs            text[]   default '{}',
  valence           real,
  arousal           real,
  dominance         real,
  -- runtime metadata
  client_meta       jsonb,                                      -- {ua, build, locale, ...}
  model_version     text,                                       -- labeler that produced snapshotted labels (e.g. 'claude-sonnet-4-5')
  schema_version    text,                                       -- _tagging_vocab + codebook version (e.g. 'vocab@1.0')
  played_at         timestamptz default now(),
  unique (session_id, room, item_id, event_index, choice_index)
);

comment on table public.narrative_logs is
  'Per-choice play log. Snapshots choices_rag labels at insert time so historical sessions stay reproducible even if labels are re-run.';

create index if not exists narrative_logs_session_idx
  on public.narrative_logs (session_id, played_at);
create index if not exists narrative_logs_player_idx
  on public.narrative_logs (player_id) where player_id is not null;
create index if not exists narrative_logs_primary_idx
  on public.narrative_logs (primary_defense);
create index if not exists narrative_logs_room_idx
  on public.narrative_logs (room);
create index if not exists narrative_logs_played_idx
  on public.narrative_logs (played_at desc);

-- (2) cards ------------------------------------------------------
create table if not exists public.cards (
  id                  bigserial primary key,
  session_id          uuid     not null unique,                 -- one card per session
  player_id           text,
  -- ensemble inputs
  query_text          text     not null,                        -- concatenation fed to embed()
  config              jsonb    not null,                        -- {embedding_model, weights, k_per_stream, filters}
  per_stream_counts   jsonb,                                    -- {items:N, lit:N, choices:N}
  -- ensemble outputs (mirrors ensemble_retrieve.aggregate() shape)
  distribution        jsonb    not null,                        -- {<28 defense>: prob}
  votes               jsonb,                                    -- {defense: raw total, ...} desc
  votes_breakdown     jsonb,                                    -- {defense: {stream: contrib}, ...}
  top_defense         text     not null,
  top_3               text[]   not null default '{}',
  vaillant_profile    jsonb    not null,                        -- {mature, neurotic, immature, psychotic}
  evidence            jsonb,                                    -- {defense: [{stream, similarity, snippet, source, primary}]}
  -- narrative output (LLM-generated card text + assets)
  narrative_summary   text,
  card_image_url      text,
  -- play stats
  n_choices           int,                                      -- count from narrative_logs at card creation
  duration_seconds    int,
  -- versioning (config jsonb already carries embedding_model)
  model_version       text,                                     -- ensemble client code version (e.g. 'ensemble@1.0')
  schema_version      text,                                     -- vocab/codebook version vote depends on (e.g. 'vocab@1.0')
  created_at          timestamptz default now()
);

comment on table public.cards is
  'End-of-session ensemble result. Mirrors Python ensemble_retrieve.retrieve() output JSON; one row per session_id.';

create index if not exists cards_player_idx
  on public.cards (player_id) where player_id is not null;
create index if not exists cards_top_defense_idx
  on public.cards (top_defense);
create index if not exists cards_top_3_gin
  on public.cards using gin (top_3);
create index if not exists cards_created_idx
  on public.cards (created_at desc);

-- (3) helper RPC: session_summary -------------------------------
-- Returns a quick rollup for client-side review screen between play and card.
drop function if exists public.session_summary(uuid);

create or replace function public.session_summary(p_session uuid)
returns table (
  n_choices         int,
  rooms_visited     int[],
  defense_counts    jsonb,
  vaillant_counts   jsonb,
  first_played_at   timestamptz,
  last_played_at    timestamptz
)
language sql stable
as $$
  with rows as (
    select * from public.narrative_logs where session_id = p_session
  ),
  d as (
    select primary_defense, count(*) c
    from rows where primary_defense is not null
    group by primary_defense
  ),
  v as (
    select vaillant_level, count(*) c
    from rows where vaillant_level is not null
    group by vaillant_level
  )
  select
    (select count(*)::int from rows),
    (select array_agg(distinct room order by room) from rows),
    (select coalesce(jsonb_object_agg(primary_defense, c), '{}'::jsonb) from d),
    (select coalesce(jsonb_object_agg(vaillant_level,  c), '{}'::jsonb) from v),
    (select min(played_at) from rows),
    (select max(played_at) from rows);
$$;

-- (4) verification -----------------------------------------------
-- after migration:
--   select to_regclass('public.narrative_logs'),
--          to_regclass('public.cards');                          -- both non-null
--   select routine_name from information_schema.routines
--    where routine_schema='public' and routine_name='session_summary';
--   -- probe a fake session:
--   select * from public.session_summary('00000000-0000-0000-0000-000000000000');
