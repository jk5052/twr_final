// /api/final-reflections
//   POST { session_id, player_id?, template_id, answer_text }
//     letter 직후, card 직전 sealing ritual 의 한 줄 답을 저장한다.
//     template_id 는 blank_fill_templates 의 id (1..10) 중 하나 — sealing
//     은 별도 prompt pool 을 두지 않고 그 풀을 그대로 재활용한다.
//     (session_id, template_id) 가 자연 키. 같은 template 에 다시 답하면
//     answer_text 가 덮어쓰여진다 (upsert).
//   GET  ?session_id=xxx
//     세션의 모든 sealing answers 를 created_at 순으로 반환 (제출 순서).
//     join 으로 template 본문도 함께 내려준다 (디버그/미리보기용).
import { createClient } from '@supabase/supabase-js'

export const dynamic = 'force-dynamic'

interface PostBody {
  session_id:   string
  player_id?:   string | null
  template_id:  number
  answer_text:  string
}

export async function POST(request: Request) {
  const url    = process.env.NEXT_PUBLIC_SUPABASE_URL
  const secret = process.env.SUPABASE_SECRET_KEY
  if (!url || !secret) return Response.json({ error: 'server env missing' }, { status: 500 })

  let body: PostBody
  try { body = await request.json() }
  catch { return Response.json({ error: 'invalid json' }, { status: 400 }) }

  if (!body.session_id) return Response.json({ error: 'session_id required' }, { status: 400 })
  if (typeof body.template_id !== 'number' || !Number.isFinite(body.template_id)) {
    return Response.json({ error: 'template_id required (number)' }, { status: 400 })
  }
  const answerText = (body.answer_text ?? '').toString().trim().slice(0, 300)
  if (!answerText) return Response.json({ error: 'answer_text required' }, { status: 400 })

  const sup = createClient(url, secret, { auth: { persistSession: false, autoRefreshToken: false } })

  // Validate template_id against the pool — surface a clean 400 instead of
  // letting the FK violation bubble up as a 500.
  const { data: tpl, error: tplErr } = await sup
    .from('blank_fill_templates')
    .select('id')
    .eq('id', body.template_id)
    .eq('active', true)
    .maybeSingle()
  if (tplErr) return Response.json({ error: 'template lookup failed: ' + tplErr.message }, { status: 500 })
  if (!tpl)   return Response.json({ error: 'unknown or inactive template_id' }, { status: 400 })

  const { error } = await sup.from('final_reflections').upsert({
    session_id:  body.session_id,
    player_id:   body.player_id ?? null,
    template_id: body.template_id,
    answer_text: answerText,
  }, { onConflict: 'session_id,template_id' })
  if (error) {
    return Response.json({ error: 'final_reflections upsert failed: ' + error.message }, { status: 500 })
  }
  return Response.json({ ok: true, template_id: body.template_id })
}

export async function GET(request: Request) {
  const url    = process.env.NEXT_PUBLIC_SUPABASE_URL
  const secret = process.env.SUPABASE_SECRET_KEY
  if (!url || !secret) return Response.json({ error: 'server env missing' }, { status: 500 })

  const session_id = new URL(request.url).searchParams.get('session_id') ?? ''
  if (!session_id) return Response.json({ error: 'session_id required' }, { status: 400 })

  const sup = createClient(url, secret, { auth: { persistSession: false, autoRefreshToken: false } })
  const { data, error } = await sup
    .from('final_reflections')
    .select('template_id, answer_text, created_at, blank_fill_templates(template)')
    .eq('session_id', session_id)
    .order('created_at', { ascending: true })
  if (error) return Response.json({ error: 'final_reflections read failed: ' + error.message }, { status: 500 })

  return Response.json({ answers: data ?? [] })
}
