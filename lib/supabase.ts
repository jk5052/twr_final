// Browser-side Supabase client (anonymous publishable key).
// 게임 진행 중 narrative_logs upsert + 게임 시작 시 choices_rag 라벨 preload.
// RLS는 prototype 동안 disable (08_runtime_rls_disable.sql).
import { createClient, type SupabaseClient } from '@supabase/supabase-js'

const url = process.env.NEXT_PUBLIC_SUPABASE_URL
const key = process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY

let cached: SupabaseClient | null = null

export function getSupabase(): SupabaseClient {
  if (cached) return cached
  if (!url || !key) {
    throw new Error(
      'Supabase env missing: NEXT_PUBLIC_SUPABASE_URL / NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY'
    )
  }
  cached = createClient(url, key, {
    auth: { persistSession: false, autoRefreshToken: false },
  })
  return cached
}
