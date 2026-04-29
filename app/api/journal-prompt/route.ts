// POST /api/journal-prompt
// 방 transition 시 호출. 세션의 최근 narrative_logs를 읽어 personalized
// 저널링 프롬프트 한 문장(영문)을 Claude로 생성해 돌려준다.
// 클라이언트는 anon만 가지고 있으므로 narrative_logs 읽기 + Anthropic 호출은
// 모두 서버에서 SUPABASE_SECRET_KEY + ANTHROPIC_API_KEY로 처리한다.
import { createClient } from '@supabase/supabase-js'

export const dynamic = 'force-dynamic'

const ANTHROPIC_URL   = 'https://api.anthropic.com/v1/messages'
const MODEL_VERSION   = 'claude-sonnet-4-5'
const SCHEMA_VERSION  = 'vocab@1.0'
const CONTEXT_LIMIT   = 5    // 직전 N choice — narrative-building 용 짧은 컨텍스트

interface PromptRequest {
  session_id:    string
  from_room:     number
  recent_event?: string | null   // 직전 이벤트 텍스트 (트리거)
  seed_words?:   string[]        // 누적 오라클 단어 — 서버가 그 중 하나 픽
}

export async function POST(request: Request) {
  const url        = process.env.NEXT_PUBLIC_SUPABASE_URL
  const secret     = process.env.SUPABASE_SECRET_KEY
  const anthropic  = process.env.ANTHROPIC_API_KEY
  if (!url || !secret || !anthropic) {
    return Response.json({ error: 'server env missing' }, { status: 500 })
  }

  let body: PromptRequest
  try {
    body = await request.json()
  } catch {
    return Response.json({ error: 'invalid json' }, { status: 400 })
  }
  if (!body.session_id || typeof body.from_room !== 'number') {
    return Response.json({ error: 'session_id, from_room required' }, { status: 400 })
  }

  const sup = createClient(url, secret, {
    auth: { persistSession: false, autoRefreshToken: false },
  })

  // 1) 최근 choice들 — narrative-building seed (라벨/디펜스는 컨텍스트로만, 출력에 노출 X)
  const { data: rows, error } = await sup
    .from('narrative_logs')
    .select('room, prompt, label, played_at')
    .eq('session_id', body.session_id)
    .order('played_at', { ascending: false })
    .limit(CONTEXT_LIMIT)
  if (error) {
    return Response.json({ error: 'narrative_logs read failed: ' + error.message }, { status: 500 })
  }

  const ctx = (rows ?? []).reverse()
  const ctxN = ctx.length

  // seed_words 는 의도적으로 LLM 컨텍스트에서 배제. 픽한 카드는 클라이언트가
  // writing step 상단에 시각적 뱃지로만 띄움. 프롬프트는 카드와 무관한
  // 저널링 프롬프트로 생성 — 플레이어의 투사 공간을 카드가 좁히지 않게.

  // 2) prompt 빌드 — sparse symbolic engine (under-determined, open for projection)
  const sys = [
    "You are a sparse symbolic prompt engine for a slow journaling RPG.",
    "The room is ONLY a trigger — do not describe it, do not invent room rules,",
    "do not generate lore. Use the recent event and choices as a seed",
    "that lets the player project outward.",
    "",
    "Output STRUCTURE (strict):",
    "  Line 1: one symbolic CONDITION + one ANOMALY in the same sentence.",
    "          (something has changed, broken, shifted, been left — but something",
    "           contradicts the expected consequence.)",
    "  Line 2: one short, plain COMPLETION QUESTION.",
    "",
    "Model:",
    "  \"A frame has split, but nothing inside it has fallen out.",
    "   What is still being held there?\"",
    "",
    "Constraints:",
    "  - Under-write. Under-determine. Leave the meaning empty for the player to fill.",
    "  - No metaphor stacking. ONE image. ONE anomaly. ONE question.",
    "  - No literary flourish, no \"as if\", no chains of clauses, no adjective stacks.",
    "  - Plain language. Concrete nouns. Simple verbs. Second person allowed but optional.",
    "  - No psychological interpretation. No diagnosis. Never name defense mechanisms.",
    "  - Total length: 18–35 words across the two lines.",
    "  - Output the two lines only. No preamble, no quotes, no labels, no explanation.",
  ].join('\n')

  const ctxBlock = ctxN === 0
    ? '(no recorded choices yet)'
    : ctx.map((r, i) =>
        `${i+1}. event="${(r.prompt as string).slice(0,140)}" → chose="${(r.label as string).slice(0,140)}"`
      ).join('\n')

  const triggerLine = body.recent_event
    ? `Recent room event (trigger only, do not describe): "${body.recent_event.slice(0, 200)}"`
    : '(no recent event provided)'

  const user = [
    triggerLine,
    '',
    'Recent choices (context, do not quote):',
    ctxBlock,
    '',
    'Write the symbolic journaling prompt now.',
  ].join('\n')

  // 3) Claude 호출
  const aiRes = await fetch(ANTHROPIC_URL, {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      'x-api-key': anthropic,
      'anthropic-version': '2023-06-01',
    },
    body: JSON.stringify({
      model: MODEL_VERSION,
      max_tokens: 220,
      system: sys,
      messages: [{ role: 'user', content: user }],
    }),
  })
  if (!aiRes.ok) {
    const errText = await aiRes.text()
    return Response.json(
      { error: 'anthropic failed', detail: errText.slice(0, 400) },
      { status: 502 },
    )
  }
  const aiJson = await aiRes.json() as { content?: Array<{ type: string; text?: string }> }
  const prompt = (aiJson.content ?? [])
    .filter(c => c.type === 'text')
    .map(c => c.text ?? '')
    .join(' ')
    .trim()

  if (!prompt) {
    return Response.json({ error: 'empty prompt from anthropic' }, { status: 502 })
  }

  return Response.json({
    prompt,
    context_n: ctxN,
    model_version:  MODEL_VERSION,
    schema_version: SCHEMA_VERSION,
  })
}
