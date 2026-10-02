// /api/sealing-prompts
//   GET  ?session_id=xxx
//     blank_fill_templates 풀 (10) 에서 session_id 해시로 3개를 deterministic
//     하게 픽한다. sealing 은 별도 prompt pool 을 두지 않고 같은 풀을 재활용 —
//     ritual 톤은 동일하지만 응답은 final_reflections 로 따로 저장된다 (스키마
//     17 참조).
//
//   픽 알고리즘: 슬롯 a/b/c 에 대해 hashSeed(session_id + ':' + slot) % pool
//   로 인덱스를 잡고, 충돌 시 다음 인덱스로 walk-forward (reject-resample) —
//   3개 모두 distinct 보장.
import { createClient } from '@supabase/supabase-js'

export const dynamic = 'force-dynamic'

interface TemplateRow { id: number; template: string }

// /api/blank-fill 의 hashSeed 와 같은 함수. 두 라우트가 같은 풀에서 픽하지만
// 슬롯 키가 다르므로 (blank-fill = session_id, sealing = session_id+':a'/...)
// 일반적으로 서로 다른 인덱스가 나온다.
function hashSeed(s: string): number {
  return Math.abs(s.split('').reduce((h, c) => ((h * 31 + c.charCodeAt(0)) | 0), 0))
}

const SLOTS = ['a', 'b', 'c'] as const

function pickThree(pool: TemplateRow[], session_id: string): TemplateRow[] {
  if (pool.length === 0) return []
  const out:  TemplateRow[] = []
  const used = new Set<number>()
  for (const slot of SLOTS) {
    const start = hashSeed(session_id + ':' + slot) % pool.length
    let i = start
    // walk-forward until we find a template not yet picked
    while (used.has(pool[i].id)) {
      i = (i + 1) % pool.length
      if (i === start) break               // pool exhausted (≤2 templates)
    }
    if (used.has(pool[i].id)) break        // truly nothing left
    used.add(pool[i].id)
    out.push(pool[i])
  }
  return out
}

export async function GET(request: Request) {
  const url    = process.env.NEXT_PUBLIC_SUPABASE_URL
  const secret = process.env.SUPABASE_SECRET_KEY
  if (!url || !secret) return Response.json({ error: 'server env missing' }, { status: 500 })

  const session_id = new URL(request.url).searchParams.get('session_id') ?? ''
  if (!session_id) return Response.json({ error: 'session_id required' }, { status: 400 })

  const sup = createClient(url, secret, { auth: { persistSession: false, autoRefreshToken: false } })
  const { data, error } = await sup
    .from('blank_fill_templates')
    .select('id, template')
    .eq('active', true)
    .order('id', { ascending: true })
  if (error) return Response.json({ error: 'blank_fill_templates read failed: ' + error.message }, { status: 500 })

  const pool = (data ?? []) as TemplateRow[]
  if (pool.length < 3) {
    return Response.json({ error: 'pool too small for 3-pick' }, { status: 500 })
  }

  const picks = pickThree(pool, session_id)
  return Response.json({
    prompts: picks.map((p) => ({ template_id: p.id, template: p.template })),
  })
}
