-- ============================================================
-- The White Room — session_analysis table
-- 게임 끝 (conversation phase 진입) 시 한 번 계산되는 통합 방어기제 프로필.
-- 입력: narrative_logs (이미 pre-labeled choice picks) + journals (raw 자유 응답).
-- 산출: primary/secondary defense, top_3, weights, Vaillant profile, evidence,
-- summary. /api/conversation 이 매 턴 narrative_logs 다시 카운트하던 걸
-- 이 row 한 번 읽기로 대체. /api/journal-label 이 upsert 한다.
-- Run in Supabase SQL Editor.
-- ============================================================

create table if not exists public.session_analysis (
  session_id        uuid    primary key,
  player_id         text,

  -- 핵심 결과 (28 defense names — twr/data/defenses.ts 표기 그대로)
  primary_defense   text    not null,
  secondary_defense text,
  top_3             text[]  not null default '{}',
  defense_weights   jsonb   not null,            -- {<defense>: 0..1, top 5}
  vaillant_profile  jsonb   not null,            -- {mature, neurotic, immature, psychotic}

  -- 근거: defense → [{source: 'choice'|'journal', room, snippet}, ...]
  evidence          jsonb,
  summary           text,                        -- 2-4 문장 LLM 분석 (internal)

  -- 입력 메타 (density 판정 / 디버그)
  n_choices         int,
  n_journals        int,
  n_silent_journals int,                         -- response = '·' 또는 빈 응답
  data_density      text,                        -- 'rich' | 'sparse' | 'minimal'

  -- 라벨러 메타
  model_version     text,
  schema_version    text,
  created_at        timestamptz default now()
);

create index if not exists session_analysis_player_idx
  on public.session_analysis (player_id) where player_id is not null;
create index if not exists session_analysis_top_idx
  on public.session_analysis (primary_defense);

-- prototyping: anon insert/select 허용 (RLS 끔, narrative_logs/journals 와 동일 정책)
alter table public.session_analysis disable row level security;

-- verification
--   select to_regclass('public.session_analysis');
--   select count(*) from public.session_analysis;
