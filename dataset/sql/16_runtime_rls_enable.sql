-- ============================================================
-- The White Room — runtime RLS hardening (supersedes 08_runtime_rls_disable.sql)
--
-- 모델: 클라이언트는 NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY (= anon role) 만 가짐.
-- 서버 (/api/*) 는 SUPABASE_SECRET_KEY (= service_role) → RLS 우회.
--
-- 클라이언트가 직접 건드리는 테이블은 단 3개:
--   narrative_logs : 매 choice 마다 upsert (own session)
--   journals       : 방 사이 글 insert    (own session)
--   choices_rag    : 게임 시작 시 select  (public reference, no PII)
--
-- 그 외 모든 테이블은 RLS on + anon 정책 없음 → service_role 만 통과.
--
-- own-session scoping: 클라이언트가 매 요청에 `x-session-id` 헤더를 박고,
-- 정책이 그 헤더와 row 의 session_id 를 비교한다. 헤더 없으면 정책 fail → 거부.
-- 보안 가정: session_id 는 crypto.randomUUID() = 122 bits 엔트로피, sessionStorage
-- 격리. 외부 enumeration 불가.
-- Run in Supabase SQL Editor (project xxdyxtgrnjesbrtalybh).
-- ============================================================

-- ============================================================
-- 1) 클라이언트 접근 허용 (own-session 정책 박힘)
-- ============================================================

-- narrative_logs ---------------------------------------------
alter table public.narrative_logs enable row level security;

drop policy if exists "narrative_logs anon select own" on public.narrative_logs;
drop policy if exists "narrative_logs anon insert own" on public.narrative_logs;
drop policy if exists "narrative_logs anon update own" on public.narrative_logs;

create policy "narrative_logs anon select own"
  on public.narrative_logs for select to anon
  using (session_id::text = current_setting('request.headers', true)::json->>'x-session-id');

create policy "narrative_logs anon insert own"
  on public.narrative_logs for insert to anon
  with check (session_id::text = current_setting('request.headers', true)::json->>'x-session-id');

create policy "narrative_logs anon update own"
  on public.narrative_logs for update to anon
  using      (session_id::text = current_setting('request.headers', true)::json->>'x-session-id')
  with check (session_id::text = current_setting('request.headers', true)::json->>'x-session-id');

-- journals ---------------------------------------------------
alter table public.journals enable row level security;

drop policy if exists "journals anon select own" on public.journals;
drop policy if exists "journals anon insert own" on public.journals;

create policy "journals anon select own"
  on public.journals for select to anon
  using (session_id::text = current_setting('request.headers', true)::json->>'x-session-id');

create policy "journals anon insert own"
  on public.journals for insert to anon
  with check (session_id::text = current_setting('request.headers', true)::json->>'x-session-id');

-- choices_rag (read-only static reference) -------------------
alter table public.choices_rag enable row level security;

drop policy if exists "choices_rag anon select all" on public.choices_rag;
create policy "choices_rag anon select all"
  on public.choices_rag for select to anon using (true);

-- ============================================================
-- 2) 나머지 — RLS on, anon 정책 없음 (= 거부). service_role 은 우회.
--    DO 블록으로 public 의 RLS-disabled 테이블 일괄 enable.
--    이미 위에서 켠 3개는 idempotent 하게 넘어감.
-- ============================================================
do $$
declare t record;
begin
  for t in
    select c.relname
      from pg_class c
      join pg_namespace n on n.oid = c.relnamespace
     where n.nspname = 'public'
       and c.relkind = 'r'                  -- ordinary tables only
       and c.relrowsecurity = false
  loop
    execute format('alter table public.%I enable row level security', t.relname);
  end loop;
end $$;

-- ============================================================
-- 3) Verification queries — SQL Editor 에서 실행해서 눈으로 확인
-- ============================================================
-- 모든 public 테이블의 RLS 상태 (relrowsecurity 가 모두 't' 여야 함)
--   select c.relname, c.relrowsecurity
--     from pg_class c
--     join pg_namespace n on n.oid = c.relnamespace
--    where n.nspname='public' and c.relkind='r'
--    order by c.relname;
--
-- anon 정책 — narrative_logs/journals 각 3/2개, choices_rag 1개, 나머지 0
--   select schemaname, tablename, policyname, cmd, roles
--     from pg_policies where schemaname='public' order by tablename, policyname;
--
-- 클라이언트 시뮬레이션 (publishable key 로 직접 curl)
--   curl 'https://<PROJECT>.supabase.co/rest/v1/narrative_logs?select=*' \
--        -H "apikey: <PUBLISHABLE_KEY>" \
--        -H "Authorization: Bearer <PUBLISHABLE_KEY>"
--   → x-session-id 헤더 없으면 [] (행 0개) 가 떠야 함. 누가 다른 세션 id 박아도
--      그 세션의 행만 보임. 어떤 식으로도 모든 행 dump 안 됨.
