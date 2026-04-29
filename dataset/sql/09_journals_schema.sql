-- ============================================================
-- The White Room — journals table
-- 방 사이 transition (door click 또는 "next room" 버튼) 시 LLM이 생성한
-- personalized prompt + 유저 free-text response를 저장한다.
-- Run in Supabase SQL Editor.
-- ============================================================

create table if not exists public.journals (
  id              bigserial primary key,
  session_id      uuid    not null,
  player_id       text,
  from_room       int     not null,
  to_room         int,                                          -- null이면 마지막 방 종료
  prompt          text    not null,                             -- LLM이 생성한 질문
  response        text,                                         -- 유저 입력 (skip 시 null)
  context_n       int,                                          -- prompt 생성 시 참고한 narrative_logs row 수
  model_version   text,
  schema_version  text,
  created_at      timestamptz default now()
);

create index if not exists journals_session_idx
  on public.journals (session_id, created_at);
create index if not exists journals_player_idx
  on public.journals (player_id) where player_id is not null;

-- prototyping: anon insert/select 허용
alter table public.journals disable row level security;

-- verification
--   select to_regclass('public.journals');
--   select relrowsecurity from pg_class where relname='journals';
