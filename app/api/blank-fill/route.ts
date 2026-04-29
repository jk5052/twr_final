// /api/blank-fill
//   GET  ?session_id=xxx  → deterministic pick from blank_fill_templates
//   POST { session_id, player_id?, template_id, answer }
//                        → embed (text-embedding-3-large 3072d halfvec)
//                          + snapshot primary_defense from narrative_logs
//                          + upsert one row per session_id
import { createClient } from '@supabase/supabase-js'

export const dynamic = 'force-dynamic'

const OPENAI_URL      = 'https://api.openai.com/v1/embeddings'
const EMBEDDING_MODEL = 'text-embedding-3-large'
const EMBEDDING_DIM   = 3072

interface TemplateRow { id: number; template: string }
interface NarrativeRow {
  primary_defense: string | null
  secondary_defense: string | null
}

// session_id 의 글자합으로 deterministic 픽. 같은 세션 = 같은 템플릿.
function hashSeed(s: string): number {
  return Math.abs(s.split('').reduce((h, c) => ((h * 31 + c.charCodeAt(0)) | 0), 0))
}

function pickTemplate(templates: TemplateRow[], session_id: string): TemplateRow | null {
  if (templates.length === 0) return null
  return templates[hashSeed(session_id) % templates.length]
}

// SupabaseClient generics shift between minor 2.x bumps and the no-args
// inference is incompatible with createClient(url, key, opts) returns.
// Side-stepping with `any` — this helper is internal, no API surface.
// eslint-disable-next-line @typescript-eslint/no-explicit-any
async function loadActiveTemplates(sup: any): Promise<TemplateRow[]> {
  const { data, error } = await sup
    .from('blank_fill_templates')
    .select('id, template')
    .eq('active', true)
    .order('id', { ascending: true })
  if (error) throw new Error('blank_fill_templates read failed: ' + error.message)
  return (data ?? []) as TemplateRow[]
}

export async function GET(request: Request) {
  const url    = process.env.NEXT_PUBLIC_SUPABASE_URL
  const secret = process.env.SUPABASE_SECRET_KEY
  if (!url || !secret) return Response.json({ error: 'server env missing' }, { status: 500 })

  const session_id = new URL(request.url).searchParams.get('session_id') ?? ''
  if (!session_id) return Response.json({ error: 'session_id required' }, { status: 400 })

  const sup = createClient(url, secret, { auth: { persistSession: false, autoRefreshToken: false } })
  let templates: TemplateRow[]
  try { templates = await loadActiveTemplates(sup) }
  catch (e) { return Response.json({ error: String(e) }, { status: 500 }) }
  const tpl = pickTemplate(templates, session_id)
  if (!tpl) return Response.json({ error: 'no active templates' }, { status: 500 })

  return Response.json({ id: tpl.id, template: tpl.template })
}

interface PostBody {
  session_id:   string
  player_id?:   string | null
  template_id?: number
  answer:       string
}

export async function POST(request: Request) {
  const url    = process.env.NEXT_PUBLIC_SUPABASE_URL
  const secret = process.env.SUPABASE_SECRET_KEY
  const openai = process.env.OPENAI_API_KEY
  if (!url || !secret || !openai) {
    return Response.json({ error: 'server env missing' }, { status: 500 })
  }

  let body: PostBody
  try { body = await request.json() }
  catch { return Response.json({ error: 'invalid json' }, { status: 400 }) }
  if (!body.session_id || typeof body.answer !== 'string' || !body.answer.trim()) {
    return Response.json({ error: 'session_id and non-empty answer required' }, { status: 400 })
  }
  const answer = body.answer.trim().slice(0, 600)

  const sup = createClient(url, secret, { auth: { persistSession: false, autoRefreshToken: false } })

  // 1) 템플릿 결정 — body.template_id 가 오면 신뢰, 아니면 GET 과 동일 해시로 재계산
  let tpl: TemplateRow | null = null
  try {
    const templates = await loadActiveTemplates(sup)
    if (typeof body.template_id === 'number') {
      tpl = templates.find((t) => t.id === body.template_id) ?? null
    }
    if (!tpl) tpl = pickTemplate(templates, body.session_id)
  } catch (e) {
    return Response.json({ error: String(e) }, { status: 500 })
  }
  if (!tpl) return Response.json({ error: 'no active templates' }, { status: 500 })

  // 2) primary_defense — narrative_logs 가중 합 (primary 1.0, secondary 0.5)
  const { data: logRows, error: logErr } = await sup
    .from('narrative_logs')
    .select('primary_defense, secondary_defense')
    .eq('session_id', body.session_id)
  if (logErr) return Response.json({ error: 'narrative_logs read failed: ' + logErr.message }, { status: 500 })
  const counts: Record<string, number> = {}
  for (const r of (logRows ?? []) as NarrativeRow[]) {
    if (r.primary_defense)   counts[r.primary_defense]   = (counts[r.primary_defense]   ?? 0) + 1.0
    if (r.secondary_defense) counts[r.secondary_defense] = (counts[r.secondary_defense] ?? 0) + 0.5
  }
  const ranked = Object.entries(counts).sort((a, b) => b[1] - a[1])
  const primary_defense = ranked[0]?.[0] ?? null

  // 3) OpenAI embeddings — text-embedding-3-large @ 3072d
  const oaRes = await fetch(OPENAI_URL, {
    method: 'POST',
    headers: { 'content-type': 'application/json', 'authorization': `Bearer ${openai}` },
    body: JSON.stringify({ model: EMBEDDING_MODEL, input: answer, dimensions: EMBEDDING_DIM }),
  })
  if (!oaRes.ok) {
    const errText = await oaRes.text()
    return Response.json({ error: 'openai embed failed', detail: errText.slice(0, 400) }, { status: 502 })
  }
  const oaJson = await oaRes.json() as { data?: Array<{ embedding: number[] }> }
  const vec = oaJson.data?.[0]?.embedding
  if (!vec || vec.length !== EMBEDDING_DIM) {
    return Response.json({ error: `embedding shape unexpected (got ${vec?.length ?? 0})` }, { status: 502 })
  }
  // pgvector / halfvec 입력 리터럴: '[v1,v2,...]'
  const halfvecLiteral = '[' + vec.join(',') + ']'

  // 4) upsert (one-per-session via unique session_id)
  const { error: upErr } = await sup.from('blank_fill_responses').upsert({
    session_id:       body.session_id,
    player_id:        body.player_id ?? null,
    template_id:      tpl.id,
    template_text:    tpl.template,
    answer,
    answer_embedding: halfvecLiteral,
    primary_defense,
  }, { onConflict: 'session_id' })
  if (upErr) {
    return Response.json({ error: 'blank_fill_responses upsert failed: ' + upErr.message }, { status: 500 })
  }

  return Response.json({
    ok:              true,
    template_id:     tpl.id,
    template:        tpl.template,
    primary_defense,
  })
}
