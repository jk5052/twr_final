// Browser-side Supabase client (anonymous publishable key).
// 게임 진행 중 narrative_logs / journals upsert + 게임 시작 시 choices_rag 라벨
// preload. RLS 는 16_runtime_rls_enable.sql 에서 켬: 자기 session_id 행만
// 읽고 쓸 수 있게 정책 박혀 있고, 정책은 `x-session-id` 헤더와 비교한다.
// 따라서 own-session 쓰기/읽기를 하려는 호출자는 sessionId 인자로 클라이언트를
// 받아야 한다. choices_rag (public reference) 만 sessionId 없이 호출 가능.
import { createClient, type SupabaseClient } from '@supabase/supabase-js'

const url = process.env.NEXT_PUBLIC_SUPABASE_URL
const key = process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY

let cached: SupabaseClient | null = null
let cachedSessionId: string | null = null

export function getSupabase(sessionId?: string): SupabaseClient {
  if (!url || !key) {
    throw new Error(
      'Supabase env missing: NEXT_PUBLIC_SUPABASE_URL / NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY'
    )
  }
  // session 헤더가 바뀌면 (or 처음이면) 클라이언트 재생성. 게임 한 판당 한 번만.
  const wanted = sessionId ?? null
  if (cached && cachedSessionId === wanted) return cached
  cached = createClient(url, key, {
    auth: { persistSession: false, autoRefreshToken: false },
    global: wanted ? { headers: { 'x-session-id': wanted } } : {},
  })
  cachedSessionId = wanted
  return cached
}
