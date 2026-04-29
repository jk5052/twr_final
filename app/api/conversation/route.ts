// POST /api/conversation
// Void(finalroom) 단계의 LLM 대화. session_id 의 narrative_logs 로
// 방어기제 프로필을 만들고, stimuli_cleaned.json 에서 같은 defense 의
// 영화 시나리오를 골라 첫 메시지로 던진다. 그 후 LLM 이 "what would you do?
// why?" 를 영어로 probe. 모든 출력은 영어.
import { createClient } from '@supabase/supabase-js'
import stimuli from '@/dataset/processed/stimuli_cleaned.json'

export const dynamic = 'force-dynamic'

const ANTHROPIC_URL  = 'https://api.anthropic.com/v1/messages'
const MODEL_VERSION  = 'claude-sonnet-4-5'
const SCHEMA_VERSION = 'vocab@1.0'
const MAX_TURNS      = 6           // user 발화 N회 후 closing 유도
const FILMS_PER_DEF  = 3           // top defense 당 후보 stimuli 몇 개

interface ChatMsg { role: 'user' | 'assistant'; content: string }
interface ConvRequest { session_id: string; messages: ChatMsg[] }

interface NarrativeRow {
  room: number; prompt: string; label: string
  primary_defense: string | null; secondary_defense: string | null
  metaphors: string[] | null; motifs: string[] | null
}

interface StimEntry {
  stimulus: string; evidence_from_plot: string
  confidence: number; film: string; defense: string
}
const STIMULI = stimuli as StimEntry[]

export async function POST(request: Request) {
  const url       = process.env.NEXT_PUBLIC_SUPABASE_URL
  const secret    = process.env.SUPABASE_SECRET_KEY
  const anthropic = process.env.ANTHROPIC_API_KEY
  if (!url || !secret || !anthropic) {
    return Response.json({ error: 'server env missing' }, { status: 500 })
  }

  let body: ConvRequest
  try { body = await request.json() } catch { return Response.json({ error: 'invalid json' }, { status: 400 }) }
  if (!body.session_id) return Response.json({ error: 'session_id required' }, { status: 400 })
  const history = Array.isArray(body.messages) ? body.messages.slice(-20) : []
  const userTurns = history.filter((m) => m.role === 'user').length

  const sup = createClient(url, secret, { auth: { persistSession: false, autoRefreshToken: false } })

  // 1) narrative_logs 로 defense 프로필 + 최근 선택 6개
  const { data: rows, error: logErr } = await sup
    .from('narrative_logs')
    .select('room, prompt, label, primary_defense, secondary_defense, metaphors, motifs')
    .eq('session_id', body.session_id)
    .order('played_at', { ascending: true })
  if (logErr) return Response.json({ error: 'narrative_logs read failed: ' + logErr.message }, { status: 500 })

  const logs = (rows ?? []) as NarrativeRow[]
  const counts: Record<string, number> = {}
  for (const r of logs) {
    if (r.primary_defense)   counts[r.primary_defense]   = (counts[r.primary_defense]   ?? 0) + 1.0
    if (r.secondary_defense) counts[r.secondary_defense] = (counts[r.secondary_defense] ?? 0) + 0.5
  }
  const ranked = Object.entries(counts).sort((a, b) => b[1] - a[1])
  const topDefs = ranked.slice(0, 3).map(([d, w]) => ({ defense: d, weight: Number(w.toFixed(2)) }))
  const topDef = topDefs[0]?.defense ?? null

  // 2) stimuli_cleaned.json 에서 top defense 매칭 시나리오를 confidence 순으로
  //    뽑음. 첫 턴에 사용할 primary 1개 + 후속 probe 용 2개. session_id hash 로
  //    deterministic 하게 1개 픽 (같은 세션 새로고침해도 같은 시나리오).
  const matched = topDef
    ? STIMULI.filter(s => s.defense === topDef)
        .sort((a, b) => b.confidence - a.confidence)
        .slice(0, FILMS_PER_DEF)
    : []
  const seed = body.session_id.split('').reduce((h, c) => (h * 31 + c.charCodeAt(0)) | 0, 0)
  const primaryStim = matched.length > 0 ? matched[Math.abs(seed) % matched.length] : null
  const altStims = matched.filter(s => s !== primaryStim)

  // 3) 최근 선택 6개 — 톤/모티프 단서
  const recent = logs.slice(-6).map((r, i) =>
    `${i + 1}. R${r.room} prompt="${r.prompt.slice(0, 100)}" → chose="${r.label.slice(0, 100)}" [${r.primary_defense ?? '?'}]`
  ).join('\n') || '(no recorded choices)'

  const profileLine = topDefs.length
    ? topDefs.map(d => `${d.defense}(${d.weight})`).join(', ')
    : '(insufficient data)'

  // 첫 턴용 primary scenario block — LLM 이 거의 그대로 인용해서 던지도록.
  const primaryBlock = primaryStim
    ? `STIMULUS (use this as the scenario you present to the player on turn 1 — quote it verbatim or with only minor edits, then add the closing question):\n"""\n${primaryStim.stimulus}\n"""`
    : '(no scenario available — improvise a short universal scenario about a difficult choice)'
  // 후속 turn 용 backup scenarios — 다른 자극으로 probe 할 때
  const altBlock = altStims.length
    ? altStims.map((s, i) => `[alt ${i + 1}]\n${s.stimulus}`).join('\n\n')
    : '(no alternates)'

  // 4) 시스템 프롬프트 — 무명의 조용한 voice. 영어 only. 첫 턴엔 stimulus 던짐.
  const wantsClosing = userTurns >= MAX_TURNS
  const isFirstTurn = history.length === 0
  const sys = [
    'You are an unnamed quiet voice inside a small white room (the Void). You have no name. Do not introduce yourself. Do not give yourself a persona name.',
    'The player has just walked through five rooms of choices. You have read their pattern of behavior across those choices.',
    'LANGUAGE: respond ONLY in English. Never use Korean or any other language.',
    'TONE: soft, low-pressure, attentive. Short sentences. No clinical jargon. No diagnoses.',
    'NEVER name defense mechanisms aloud. NEVER summarize the player. NEVER moralize or advise.',
    '',
    'Player defense profile (internal context — do NOT mention by name):',
    `  ${profileLine}`,
    'Recent choices (internal context — do NOT quote verbatim):',
    recent,
    '',
    'Primary scenario (drawn from a film that shares the same pattern — do NOT mention any film title or character names):',
    primaryBlock,
    '',
    'Alternate scenarios (use only if the player gets stuck or you need a fresh angle later):',
    altBlock,
    '',
    'Behavior:',
    '  - Each reply: 1-4 short sentences. Preserve any line breaks already present in a quoted scenario.',
    '  - After the player answers, probe gently: "Why?", "What about in this case…?", "What made you feel that way?", "Would you do the same if it were someone else?"',
    '  - Mirror their words. Do not advise. Do not interpret out loud.',
    isFirstTurn
      ? '  - THIS IS THE FIRST TURN. Open by presenting the PRIMARY SCENARIO above. You may quote it nearly verbatim (preserving its line breaks and its closing "Why?") or lightly paraphrase, but keep its shape: a short evocative situation followed by a two-option question and the word "Why?". Do NOT add a greeting, do NOT explain, do NOT mention the rooms they walked through. Just present the scenario and let it sit.'
      : '  - THIS TURN: ask ONE short, concrete follow-up question grounded in their previous answer or in one of the alternate scenarios above (never name a film). Pick whichever feels more alive.',
    wantsClosing
      ? '  - WIND DOWN: this is your final response. In one or two sentences, gently acknowledge what you noticed in their answers (without naming any defense). End with the exact sentence: "You can leave the room now."'
      : '  - Continue the conversation. Do not say goodbye yet.',
    '',
    'Output ONLY the spoken line(s). No labels, no quotation marks around your whole reply, no preamble like "Here is…".',
  ].join('\n')

  // 5) Claude 호출 — 첫 턴은 messages=[] 라 합성 user 메시지로 시작
  const apiMessages: ChatMsg[] = history.length > 0 ? history : [{ role: 'user', content: '(begin)' }]
  const aiRes = await fetch(ANTHROPIC_URL, {
    method: 'POST',
    headers: { 'content-type': 'application/json', 'x-api-key': anthropic, 'anthropic-version': '2023-06-01' },
    body: JSON.stringify({ model: MODEL_VERSION, max_tokens: 350, system: sys, messages: apiMessages }),
  })
  if (!aiRes.ok) {
    const errText = await aiRes.text()
    return Response.json({ error: 'anthropic failed', detail: errText.slice(0, 400) }, { status: 502 })
  }
  const aiJson = await aiRes.json() as { content?: Array<{ type: string; text?: string }> }
  const message = (aiJson.content ?? [])
    .filter(c => c.type === 'text').map(c => c.text ?? '').join(' ').trim()
  if (!message) return Response.json({ error: 'empty message from anthropic' }, { status: 502 })

  return Response.json({
    message,
    turn_count:    userTurns + 1,        // assistant 응답 후 진행된 턴 수
    kind:          wantsClosing ? 'closing' : 'question',
    profile:       topDefs,
    films_used:    matched.map(s => s.film),
    primary_film:  primaryStim?.film ?? null,
    model_version:  MODEL_VERSION,
    schema_version: SCHEMA_VERSION,
  })
}
