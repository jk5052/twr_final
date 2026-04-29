-- ============================================================
-- The White Room — endgame artifacts
--   blank_fill_templates   : 10 fill-in-the-blank prompt nuances (static reference)
--   blank_fill_responses   : per-session player answer to one randomly-assigned template
--   seed_letters           : pool of letters (jayce-seeded + later: player-replies ingested)
--   letter_exchanges       : which seed_letter a session received + the player's reply
--   generated_cards        : AI-generated talisman card (Flux Schnell etc.) one-per-session
--
-- Existing tables we reference (do not alter here):
--   narrative_logs (06_runtime_schema.sql)  — primary_defense snapshots per choice
--   cards          (06_runtime_schema.sql)  — ensemble result, distinct from generated_cards
--   journals       (09_journals_schema.sql) — between-room transition prompts
--
-- Embedding columns mirror existing RAG tables: halfvec(3072) (text-embedding-3-large).
-- Run in Supabase SQL Editor (project xxdyxtgrnjesbrtalybh).
-- ============================================================

-- (1) blank_fill_templates ---------------------------------------
create table if not exists public.blank_fill_templates (
  id            int     primary key,
  template      text    not null,            -- e.g. '나는 자주 ___ 한다'
  notes         text,
  active        boolean default true
);

insert into public.blank_fill_templates (id, template) values
  (1,  '나는 자주 ___ 한다'),
  (2,  '나는 ___ 한 사람이다'),
  (3,  '나는 ___ 할 때 편하다'),
  (4,  '나는 ___ 한 자리에 머문다'),
  (5,  '나는 ___ 들고 다닌다'),
  (6,  '나는 ___ 켜둔다'),
  (7,  '나는 ___ 두고 왔다'),
  (8,  '나는 ___ 자주 돌아간다'),
  (9,  '나는 ___ 묻어두었다'),
  (10, '나는 ___ 비춰본다')
on conflict (id) do nothing;

-- (2) blank_fill_responses ---------------------------------------
create table if not exists public.blank_fill_responses (
  id                bigserial primary key,
  session_id        uuid    not null unique,        -- one per session
  player_id         text,
  template_id       int     not null references public.blank_fill_templates(id),
  template_text     text    not null,               -- snapshot at insert time
  answer            text    not null,               -- raw player answer
  answer_embedding  halfvec(3072),                  -- populated by server for letter matching
  primary_defense   text,                           -- snapshotted at end-of-session (top-1 from cards/ensemble)
  created_at        timestamptz default now()
);
create index if not exists blank_fill_defense_idx
  on public.blank_fill_responses (primary_defense);

-- (3) seed_letters -----------------------------------------------
create table if not exists public.seed_letters (
  id                uuid    primary key default gen_random_uuid(),
  source            text    not null default 'seed',     -- 'seed' | 'player'
  author_pseudonym  text,                                -- nullable; for seed letters provide gentle pseudonym
  primary_defense   text    not null,                    -- one of 28 codebook names
  blank_template_id int,                                 -- which template the author answered (for 'player' source)
  blank_answer      text,                                -- author's blank-fill answer (for matching)
  blank_answer_embedding halfvec(3072),
  letter_text       text    not null,
  origin_session_id uuid,                                -- backref when source='player'
  active            boolean default true,
  created_at        timestamptz default now()
);
create index if not exists seed_letters_defense_idx
  on public.seed_letters (primary_defense) where active;
create index if not exists seed_letters_source_idx
  on public.seed_letters (source) where active;

-- (4) letter_exchanges -------------------------------------------
create table if not exists public.letter_exchanges (
  id                  bigserial primary key,
  session_id          uuid    not null unique,            -- one received letter per session
  player_id           text,
  received_letter_id  uuid    not null references public.seed_letters(id),
  reply_text          text,                               -- player's reply (free text, may be null on skip)
  reply_letter_id     uuid    references public.seed_letters(id),  -- if reply was ingested back into pool
  created_at          timestamptz default now()
);
create index if not exists letter_exchanges_received_idx
  on public.letter_exchanges (received_letter_id);

-- (5) generated_cards --------------------------------------------
create table if not exists public.generated_cards (
  id                  bigserial primary key,
  session_id          uuid    not null unique,
  player_id           text,
  primary_defense     text    not null,                    -- one of 28 codebook names
  positive_framing    text    not null,                    -- from defense_positive_framing.json
  blank_answer        text,                                -- snapshot of blank_fill_responses.answer
  picked_words        text[]  default '{}',                -- oracle words player picked across journaling
  prompt_used         text    not null,                    -- full prompt sent to image API
  image_url           text    not null,                    -- public URL (Supabase Storage)
  image_storage_path  text,                                -- bucket path for re-hosting/print
  image_provider      text    not null,                    -- 'flux-schnell' | 'dalle3' | 'sdxl'
  model_version       text,
  width               int,
  height              int,
  created_at          timestamptz default now()
);
create index if not exists generated_cards_defense_idx
  on public.generated_cards (primary_defense);

-- (6) prototyping: anon insert/select 허용 (RLS off for playtest) -
alter table public.blank_fill_templates  disable row level security;
alter table public.blank_fill_responses  disable row level security;
alter table public.seed_letters          disable row level security;
alter table public.letter_exchanges      disable row level security;
alter table public.generated_cards       disable row level security;

-- (7) verification -----------------------------------------------
--   select to_regclass(tbl) from unnest(array[
--     'public.blank_fill_templates','public.blank_fill_responses',
--     'public.seed_letters','public.letter_exchanges','public.generated_cards'
--   ]) tbl;
--   select count(*) from public.blank_fill_templates;   -- expect 10
--   select id, template from public.blank_fill_templates order by id;
