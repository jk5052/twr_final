-- ============================================================
-- The White Room — final_reflections (sealing ritual)
--
-- letter exchange 직후 card 진입 직전, player 가 방을 떠나며 남기는 3개의
-- 짧은 문장. blank_fill_templates 풀 (10) 을 그대로 재활용한다 — sealing
-- 전용 prompt 는 두지 않는다. /api/sealing-prompts 가 session_id 해시로
-- 3개 template 을 deterministic 하게 픽하고, SealingOverlay 가 그 3개를
-- 순차로 띄운 뒤 여기에 answer 만 저장한다.
--
-- (session_id, template_id) 가 자연 키. 같은 template 에 다시 답하면
-- answer_text 만 덮어쓴다 (upsert). 세션당 최대 3 row.
--
-- letter/poem matching 단계가 이미 끝난 뒤이므로 embedding 은 두지 않는다.
-- 표면 표시 (talisman PDF page 1) + 최종 image generation 의 mood prompt
-- input 으로만 쓰임.
--
-- 클라이언트는 /api/final-reflections (service_role) 만 통해 write/read 한다.
-- RLS on, anon 정책 없음 → 외부 직접 query 는 거부 (16 과 동일 정책 패턴).
-- Run in Supabase SQL Editor (project xxdyxtgrnjesbrtalybh).
--
-- NOTE: 이전 초안 (prompt_key/prompt_text 스키마) 을 이미 실행했다면 먼저
--   drop table public.final_reflections;
-- 후 재실행할 것.
-- ============================================================

create table if not exists public.final_reflections (
  id           bigserial primary key,
  session_id   uuid    not null,
  player_id    text,
  template_id  int     not null references public.blank_fill_templates(id),
  answer_text  text    not null,        -- player-authored phrase (trimmed, ≤300 chars)
  created_at   timestamptz default now(),
  unique (session_id, template_id)
);

create index if not exists final_reflections_session_idx
  on public.final_reflections (session_id);
create index if not exists final_reflections_template_idx
  on public.final_reflections (template_id);

-- RLS on, anon 정책 없음 → service_role 만 통과 (16 의 fallback 패턴과 동일).
-- /api/final-reflections / /api/card-bundle 은 SUPABASE_SECRET_KEY 사용.
alter table public.final_reflections enable row level security;

-- verification
--   select to_regclass('public.final_reflections');
--   select count(*) from public.final_reflections;
--   select fr.session_id, fr.template_id, t.template, fr.answer_text
--     from public.final_reflections fr
--     join public.blank_fill_templates t on t.id = fr.template_id
--     order by fr.created_at desc limit 12;
