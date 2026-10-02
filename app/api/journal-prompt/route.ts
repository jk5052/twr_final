// POST /api/journal-prompt
// 방 transition 시 호출. journaling-game 전통 (Thousand Year Old Vampire,
// Alone Among the Stars, Quill, The Wretched, Be Like a Crow, For the Queen,
// Apothecaria, Ironsworn) 의 worldbuilding prompt 한 항목 (두 줄 영문) 을
// Claude 로 생성. 카드/방-사건은 의도적으로 LLM 컨텍스트에서 제외 — 이건
// 플레이어 자신의 세계 한 조각을 적게 유도하는 빈 invitation 이지 게임 lore
// 의 연장이 아님. 카드는 클라이언트가 옆에 영감 자료로만 띄움.
//
// recent_event 와 narrative_logs 는 받기는 하되 LLM 에 안 넣고, journals row
// 의 메타로만 남는다 (context_n 카운트 용).
import { createClient } from '@supabase/supabase-js'

export const dynamic = 'force-dynamic'

const ANTHROPIC_URL   = 'https://api.anthropic.com/v1/messages'
const MODEL_VERSION   = 'claude-sonnet-4-5'
const SCHEMA_VERSION  = 'journaling@1.0'
const CONTEXT_LIMIT   = 5    // narrative_logs 카운트 (메타용, LLM 에 안 들어감)

// 호출마다 anchor 하나를 랜덤 pick 해 user message 에 넣어 LLM 출력의 변주를
// 강제. 안 넣으면 같은 컨텍스트에서 비슷한 이미지 (door, frame, room) 로
// 수렴함. journaling game 전통의 small-anchor 원칙 — 손, 이름, 식사, 실, 거리.
const ANCHORS = [
  'a hand', 'a doorway you have passed through more than once',
  'a name spoken twice', 'a meal you remember the smell of',
  'a small lie', 'someone you walked past', 'a thread', 'a debt',
  'a return', 'a gift the size of a coin', 'a silence between two people',
  'a gesture', 'a future small enough to hold in one hand',
  'something carried', 'a ritual', 'a piece of cloth', 'a kept secret',
  'a song you cannot sing', 'a window', 'a room in a place you no longer live',
  'a letter never sent', 'a stranger\'s face', 'an unfinished sentence',
  'a borrowed object', 'a weather you remember', 'a path taken twice',
  'a habit', 'a number', 'a key', 'a small future', 'a forgotten word',
  'a mirror', 'a stone in a pocket',
] as const

interface PromptRequest {
  session_id:    string
  from_room:     number
  recent_event?: string | null   // 직전 이벤트 텍스트 (트리거)
  seed_words?:   string[]        // legacy — 안 쓰임
  seed_cards?:   number[]        // 직전에 player 가 고른 readymade card id 들
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

  // 1) narrative_logs 는 카운트만 (LLM 인풋에서 제외 — journals 메타로만 남김).
  const { count: ctxCount, error } = await sup
    .from('narrative_logs')
    .select('*', { count: 'exact', head: true })
    .eq('session_id', body.session_id)
  if (error) {
    return Response.json({ error: 'narrative_logs read failed: ' + error.message }, { status: 500 })
  }
  const ctxN = Math.min(ctxCount ?? 0, CONTEXT_LIMIT)

  // 2) prompt 빌드 — journaling-game worldbuilding prompt.
  //    카드/방-사건은 의도적으로 안 들어감. LLM 출력은 player 자기 세계의
  //    한 조각 (memory / place / person / ritual / small future) 으로 가도록.
  const sys = [
    "You write prompts for a contemplative journaling game in the tradition of",
    "Thousand Year Old Vampire (Tim Hutchings), Alone Among the Stars (Takuma",
    "Okada), Quill (Scott Malthouse), The Wretched (Chris Bissette), Be Like a",
    "Crow, and For the Queen (Alex Roberts).",
    "",
    "The player is sitting alone with a notebook between rooms in a white space.",
    "Your prompt invites the player to add ONE small piece to their own personal",
    "world — a memory, a place, a person, a ritual, a fear, a kept thing, a small",
    "future. The room and the game itself are NOT the topic. The player is",
    "the topic. Their imagined world is the topic.",
    "",
    "Output STRUCTURE (strict, two short lines):",
    "  Line 1: a concrete sensory invitation in second person, anchored on the",
    "          provided ANCHOR. Gently specific, not abstract.",
    "          (\"Picture a doorway you have passed through more than once.\")",
    "  Line 2: an open question that asks the player to tell you something true",
    "          (real or imagined) about that thing.",
    "          (\"Who was on the other side, the last time?\")",
    "",
    "Constraints:",
    "  - Worldbuilding / personal narrative. NEVER reference the white room,",
    "    the game, choices the player made, doors as game objects, frames,",
    "    rooms-as-this-game, or any meta narrative.",
    "  - Plain language. Concrete nouns. Simple verbs. Second person.",
    "  - Under-determine. Leave the meaning empty for the player to fill.",
    "  - No metaphor stacking. ONE image. ONE question.",
    "  - No psychological interpretation. Never name emotions clinically.",
    "    Never mention defenses, trauma, healing, growth, journey.",
    "  - Total length: 18–32 words across the two lines.",
    "  - Output the two lines only. No labels, no quotes, no preamble, no",
    "    explanation, no headings.",
  ].join('\n')

  const anchor = ANCHORS[Math.floor(Math.random() * ANCHORS.length)]
  // seed_cards: 카드 자체는 추상 이미지 (LLM 이 못 봄) 라 id 를 그대로 넣어도
  // 의미가 없다. 대신 "방금 N장의 이미지가 player 를 끌어당겼다" 는 사실만
  // 신호로 전달 — LLM 이 그 끌림을 prompt 의 시작점으로 삼게 한다. anchor 는
  // 여전히 concrete sensory invitation 의 grounding 역할.
  const pickedCount = Array.isArray(body.seed_cards) ? body.seed_cards.length : 0
  const cardLine = pickedCount > 0
    ? `PICKED: the player just chose ${pickedCount} image${pickedCount === 1 ? '' : 's'} they could not look away from.`
    : null
  const user = [
    `ANCHOR: ${anchor}`,
    ...(cardLine ? ['', cardLine] : []),
    '',
    cardLine
      ? 'Write the journaling prompt now. Begin from the pull of the image they just chose, then enter the anchor as the concrete sensory ground. Two lines. Do not name the image itself.'
      : 'Write the journaling prompt now. Two lines. Stay with the anchor.',
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
