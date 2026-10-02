// Symbolic mood extraction — 4–7 short phrases drawn from the player's own
// language across narrative_logs / journals / blank_fill / final_reflections.
// Called once during /api/card-bundle (sequentially before the Flux call so
// the phrases can flavor the prompt). Sonnet 4.5 is sufficient — this is
// vocabulary lifting, not reasoning.
import type { SupabaseClient } from '@supabase/supabase-js'
import { stripLoneSurrogates, buildAnthropicBody } from '@/lib/anthropicSanitize'

const ANTHROPIC_URL  = 'https://api.anthropic.com/v1/messages'
const MODEL_VERSION  = 'claude-sonnet-4-5'
const SILENT         = '\u00b7'

const MOOD_TOOL = {
  name: 'submit_mood_words',
  description: 'Submit 4–7 short symbolic phrases drawn from the player\'s own language across the session.',
  input_schema: {
    type: 'object',
    required: ['phrases'],
    properties: {
      phrases: {
        type: 'array',
        minItems: 4, maxItems: 7,
        items: { type: 'string', minLength: 1, maxLength: 30 },
      },
    },
  },
} as const

const SYSTEM_PROMPT = [
  'You are reading inner-monologue traces from a quiet first-person journaling',
  'RPG (The White Room). Your job is to extract 4–7 short symbolic phrases that',
  'capture the texture of the session — drawn from the player\'s own language',
  'wherever possible.',
  '',
  'Mix categories — do NOT return five emotion labels:',
  '  - objects:        door, mirror, table, hallway, lamp',
  '  - affects:        shame, calm, dread, longing, apathy',
  '  - gestures:       waiting, hiding, circling, returning',
  '  - relational:     watched, abandoned, protected, refused',
  '  - textures:       cold light, sealed, dim, soft, unfinished',
  '',
  'Constraints:',
  '  - 1–3 words per phrase. No sentences.',
  '  - Lowercase. No punctuation.',
  '  - No clinical/diagnostic terms (do NOT use defense names like',
  '    "isolation", "suppression", "denial", "regression", etc).',
  '  - Prefer concrete words the player actually wrote; if data is sparse,',
  '    abstract carefully and stay symbolic.',
  '  - Treat the silence sentinel "·" as evidence of withheld feeling, not',
  '    absence — let it color one phrase if it dominates.',
  '',
  'Call submit_mood_words with the final list.',
].join('\n')

interface NarrativeRow { event_text: string | null; response: string | null }
interface JournalRow   { response: string | null }
interface FinalRow     { template_id: number; answer_text: string }
interface TemplateRow  { id: number; template: string }

const isSilent = (s: string | null | undefined) =>
  !s || s.trim() === '' || s.trim() === SILENT

export async function extractMoodWords(
  sup: SupabaseClient, anthropicKey: string, sessionId: string, blankAnswer: string | null,
): Promise<string[]> {
  const [logsRes, jrnRes, finRes] = await Promise.all([
    sup.from('narrative_logs')
      .select('event_text, response')
      .eq('session_id', sessionId)
      .order('played_at', { ascending: true }),
    sup.from('journals')
      .select('response')
      .eq('session_id', sessionId)
      .order('created_at', { ascending: true }),
    sup.from('final_reflections')
      .select('template_id, answer_text')
      .eq('session_id', sessionId)
      .order('created_at', { ascending: true }),
  ])
  const logs = (logsRes.data ?? []) as NarrativeRow[]
  const jrns = (jrnRes.data  ?? []) as JournalRow[]
  const fins = (finRes.data  ?? []) as FinalRow[]

  // Resolve template text for each sealing answer (sealing reuses the
  // blank_fill_templates pool — see migration 17). Fail-soft: if the lookup
  // fails the sealing block degrades to "(template N) → answer".
  const tplById = new Map<number, string>()
  if (fins.length > 0) {
    const ids = Array.from(new Set(fins.map((f) => f.template_id)))
    const { data: tplRows } = await sup
      .from('blank_fill_templates')
      .select('id, template')
      .in('id', ids)
    for (const r of (tplRows ?? []) as TemplateRow[]) tplById.set(r.id, r.template)
  }

  if (logs.length === 0 && jrns.length === 0 && fins.length === 0 && !blankAnswer) {
    return []
  }

  const choicesBlock = logs.length === 0 ? '(none)' : logs.map((r, i) =>
    `${i+1}. prompt="${(r.event_text ?? '').slice(0,140)}" | chose="${(r.response ?? '').slice(0,140)}"`
  ).join('\n')
  const journalsBlock = jrns.length === 0 ? '(none)' : jrns.map((j, i) => {
    const tag = isSilent(j.response) ? '[silent]' : ''
    return `${i+1}. ${tag} ${(j.response ?? '').slice(0, 400).replace(/\n/g, ' ')}`
  }).join('\n')
  const sealingBlock = fins.length === 0 ? '(none)' : fins.map((f) => {
    const tpl = tplById.get(f.template_id) ?? `(template ${f.template_id})`
    return `- "${tpl}" → ${f.answer_text}`
  }).join('\n')
  const blankBlock = blankAnswer && blankAnswer.trim() ? blankAnswer.trim() : '(none)'

  const user = [
    'CHOICES (player picks):',
    choicesBlock,
    '',
    'JOURNALS (free writing between rooms):',
    journalsBlock,
    '',
    'BLANK_FILL (one-line self-statement):',
    blankBlock,
    '',
    'SEALING (final ritual phrases on departure):',
    sealingBlock,
    '',
    'Now call submit_mood_words.',
  ].join('\n')

  // user 블록은 narrative_logs/journals/final_reflections/blank_fill 에서 온
  // player 자유 텍스트가 섞여 있어 lone UTF-16 surrogate 가 들어올 수 있음.
  // source 정화 + post-stringify 정화로 Anthropic strict JSON 파서 보호.
  const cleanUser = stripLoneSurrogates(user)
  const aiRes = await fetch(ANTHROPIC_URL, {
    method: 'POST',
    headers: { 'content-type': 'application/json', 'x-api-key': anthropicKey, 'anthropic-version': '2023-06-01' },
    body: buildAnthropicBody({
      model: MODEL_VERSION,
      max_tokens: 512,
      system: SYSTEM_PROMPT,
      tools: [MOOD_TOOL],
      tool_choice: { type: 'tool', name: MOOD_TOOL.name },
      messages: [{ role: 'user', content: cleanUser }],
    }),
  })
  if (!aiRes.ok) {
    console.warn('[moodExtraction] anthropic failed:', (await aiRes.text()).slice(0, 200))
    return []
  }
  const aiJson = await aiRes.json() as {
    content?: Array<{ type: string; name?: string; input?: Record<string, unknown> }>
  }
  const tool = (aiJson.content ?? []).find((c) => c.type === 'tool_use' && c.name === MOOD_TOOL.name)
  const raw  = tool?.input && Array.isArray((tool.input as { phrases?: unknown }).phrases)
    ? (tool.input as { phrases: unknown[] }).phrases
    : []
  const phrases = raw
    .filter((p): p is string => typeof p === 'string' && !!p.trim())
    .map((p) => p.trim().toLowerCase())
    .slice(0, 7)
  return phrases
}
