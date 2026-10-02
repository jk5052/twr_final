// POST /api/journal-label
// 마지막 방 → conversation 으로 넘어가기 직전 (또는 conversation 첫 턴에서
// lazy 하게) 한 번 호출. narrative_logs + journals 를 통합해 Claude 로
// 분석하고 session_analysis row 를 upsert. 이미 분석된 세션이면 캐시된
// row 를 그대로 반환. 본 엔드포인트는 idempotent.
import { createClient } from '@supabase/supabase-js'
import { getOrCreateSessionAnalysis } from '@/lib/sessionAnalysis'

export const dynamic = 'force-dynamic'

interface LabelRequest { session_id: string }

export async function POST(request: Request) {
  const url       = process.env.NEXT_PUBLIC_SUPABASE_URL
  const secret    = process.env.SUPABASE_SECRET_KEY
  const anthropic = process.env.ANTHROPIC_API_KEY
  if (!url || !secret || !anthropic) {
    return Response.json({ error: 'server env missing' }, { status: 500 })
  }

  let body: LabelRequest
  try { body = await request.json() } catch { return Response.json({ error: 'invalid json' }, { status: 400 }) }
  if (!body.session_id) return Response.json({ error: 'session_id required' }, { status: 400 })

  const sup = createClient(url, secret, { auth: { persistSession: false, autoRefreshToken: false } })
  const result = await getOrCreateSessionAnalysis(sup, anthropic, body.session_id)
  if ('error' in result) return Response.json({ error: result.error }, { status: result.status })

  return Response.json({
    cached:            result.cached,
    primary_defense:   result.row.primary_defense,
    secondary_defense: result.row.secondary_defense,
    top_3:             result.row.top_3,
    defense_weights:   result.row.defense_weights,
    vaillant_profile:  result.row.vaillant_profile,
    data_density:      result.row.data_density,
    n_choices:         result.row.n_choices,
    n_journals:        result.row.n_journals,
    n_silent_journals: result.row.n_silent_journals,
    model_version:     result.row.model_version,
    schema_version:    result.row.schema_version,
  })
}
