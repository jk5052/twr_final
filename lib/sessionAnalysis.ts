// 통합 방어기제 분석 — narrative_logs (pre-labeled choice picks) + journals
// (raw 자유 응답) 을 한 번에 Claude 에 던져 session_analysis row 를 만든다.
// /api/journal-label 와 /api/conversation 이 공유. 멱등 — 이미 row 있으면
// 그대로 반환.
import codebook from '@/dataset/processed/defense_codebook.json'
import type { SupabaseClient } from '@supabase/supabase-js'
import { stripLoneSurrogates, buildAnthropicBody } from '@/lib/anthropicSanitize'

const ANTHROPIC_URL  = 'https://api.anthropic.com/v1/messages'
const MODEL_VERSION  = 'claude-opus-4-7'        // 통합 분석은 세션당 1회 → Opus 사용
const SCHEMA_VERSION = 'session-analysis@2.0'   // 2.0 = tool_use enum-locked output
const SILENT_SENTINEL = '\u00b7'   // intentional silence marker (·)

type CodebookEntry = {
  name: string; vaillant_level: string; definition?: string
  linguistic_signals?: string[]; narrative_patterns?: string[]
}
const CB = codebook as Record<string, CodebookEntry>

// 인라인 시스템 프롬프트용 compact codebook. 28 defense × ~10줄 ≈ 5K 토큰.
// linguistic/narrative top-N 만 추리고 정의는 280자 cap. 풀 정의는 dataset
// 빌드 단계에서만 필요하고 라벨러는 disambiguation 키워드만 있으면 됨.
const CODEBOOK_BLOCK = Object.values(CB)
  .filter((e) => e.name && !('_error' in e))
  .map((e) => {
    const sig = (e.linguistic_signals ?? []).slice(0, 4).join(' / ')
    const nar = (e.narrative_patterns ?? []).slice(0, 3).join(' / ')
    const def = (e.definition ?? '').slice(0, 280)
    return `## ${e.name} [${e.vaillant_level}]\n  def: ${def}\n  ling: ${sig}\n  narr: ${nar}`
  }).join('\n\n')

// 28 defense 표기 — codebook 의 name 그대로. tool input_schema 의 enum 으로 박혀
// LLM 이 표기 흐트러뜨리는 것 자체가 불가능. stimuli_cleaned.json 의 defense
// 값과 1:1 일치 (확인됨) → matching 안 깨짐.
const DEFENSE_NAMES = Object.values(CB)
  .filter((e) => e.name && !('_error' in e))
  .map((e) => e.name)

// Anthropic tool_use schema. summary 와 confidence_level 빼곤 모든 defense 슬롯이
// enum 강제. defense_weights / evidence 는 dict 대신 array-of-objects 로 받음
// (JSON Schema 의 propertyNames-enum 호환성 회피). 저장 직전에 dict 으로 변환.
const ANALYSIS_TOOL = {
  name: 'submit_session_analysis',
  description: 'Submit the unified defense-mechanism analysis for this session.',
  input_schema: {
    type: 'object',
    required: ['primary_defense', 'top_3', 'defense_weights', 'vaillant_profile', 'evidence', 'summary', 'confidence_level'],
    properties: {
      primary_defense:   { type: 'string', enum: DEFENSE_NAMES },
      secondary_defense: { anyOf: [{ type: 'string', enum: DEFENSE_NAMES }, { type: 'null' }] },
      top_3: {
        type: 'array', minItems: 1, maxItems: 3,
        items: { type: 'string', enum: DEFENSE_NAMES },
      },
      defense_weights: {
        type: 'array', minItems: 1, maxItems: 5,
        description: 'Up to 5 defenses with their weights (0..1, sum ≈ 1).',
        items: {
          type: 'object', required: ['defense', 'weight'],
          properties: {
            defense: { type: 'string', enum: DEFENSE_NAMES },
            weight:  { type: 'number', minimum: 0, maximum: 1 },
          },
        },
      },
      vaillant_profile: {
        type: 'object',
        required: ['mature', 'neurotic', 'immature', 'psychotic'],
        description: 'Vaillant maturity distribution; values 0..1, sum = 1.',
        properties: {
          mature:    { type: 'number', minimum: 0, maximum: 1 },
          neurotic:  { type: 'number', minimum: 0, maximum: 1 },
          immature:  { type: 'number', minimum: 0, maximum: 1 },
          psychotic: { type: 'number', minimum: 0, maximum: 1 },
        },
      },
      evidence: {
        type: 'array', maxItems: 5,
        description: 'Per-defense citations (≤3 per defense).',
        items: {
          type: 'object', required: ['defense', 'citations'],
          properties: {
            defense: { type: 'string', enum: DEFENSE_NAMES },
            citations: {
              type: 'array', maxItems: 3,
              items: {
                type: 'object', required: ['source', 'room', 'snippet'],
                properties: {
                  source:  { type: 'string', enum: ['choice', 'journal'] },
                  room:    { type: 'integer', minimum: 1 },
                  snippet: { type: 'string', maxLength: 140 },
                },
              },
            },
          },
        },
      },
      summary:          { type: 'string', description: '2-4 sentences, internal use only.' },
      confidence_level: { type: 'string', enum: ['high', 'medium', 'low'] },
    },
  },
} as const

interface NarrativeRow {
  room: number; prompt: string | null; label: string | null
  primary_defense: string | null; secondary_defense: string | null
}
interface JournalRow {
  from_room: number; prompt: string | null; response: string | null
  player_id?: string | null
}

export interface SessionAnalysisRow {
  session_id:        string
  player_id:         string | null
  primary_defense:   string
  secondary_defense: string | null
  top_3:             string[]
  defense_weights:   Record<string, number>
  vaillant_profile:  { mature: number; neurotic: number; immature: number; psychotic: number }
  evidence:          Record<string, Array<{ source: 'choice' | 'journal'; room: number; snippet: string }>>
  summary:           string | null
  n_choices:         number
  n_journals:        number
  n_silent_journals: number
  data_density:      'rich' | 'sparse' | 'minimal'
  model_version:     string
  schema_version:    string
}

const isSilent = (s: string | null | undefined) => !s || s.trim() === '' || s.trim() === SILENT_SENTINEL

export async function getOrCreateSessionAnalysis(
  sup: SupabaseClient, anthropicKey: string, sessionId: string,
): Promise<{ row: SessionAnalysisRow; cached: boolean } | { error: string; status: number }> {
  // 0) 이미 분석된 세션이면 그대로 반환 (멱등).
  const ex = await sup.from('session_analysis').select('*').eq('session_id', sessionId).maybeSingle()
  if (ex.error) return { error: 'session_analysis read: ' + ex.error.message, status: 500 }
  if (ex.data)  return { row: ex.data as SessionAnalysisRow, cached: true }

  // 1) 입력 데이터 수집
  const [logsRes, jrnRes] = await Promise.all([
    sup.from('narrative_logs')
      .select('room, prompt, label, primary_defense, secondary_defense, player_id')
      .eq('session_id', sessionId)
      .order('played_at', { ascending: true }),
    sup.from('journals')
      .select('from_room, prompt, response, player_id')
      .eq('session_id', sessionId)
      .order('created_at', { ascending: true }),
  ])
  if (logsRes.error) return { error: 'narrative_logs read: ' + logsRes.error.message, status: 500 }
  if (jrnRes.error)  return { error: 'journals read: ' + jrnRes.error.message,        status: 500 }

  const logs = (logsRes.data ?? []) as (NarrativeRow & { player_id?: string | null })[]
  const jrns = (jrnRes.data  ?? []) as JournalRow[]
  if (logs.length === 0 && jrns.length === 0) {
    return { error: 'no narrative_logs and no journals for session', status: 409 }
  }
  const playerId = logs[0]?.player_id ?? jrns[0]?.player_id ?? null

  // density 판정 — LLM 의 confidence_level 출력에 영향
  const nSilent  = jrns.filter(j => isSilent(j.response)).length
  const nWritten = jrns.length - nSilent
  const density: 'rich' | 'sparse' | 'minimal' =
    (logs.length >= 8 && nWritten >= 2) ? 'rich' :
    (logs.length >= 4 || nWritten >= 1) ? 'sparse' : 'minimal'

  // 2) Claude 인풋 구성
  const choicesBlock = logs.length === 0 ? '(none)' : logs.map((r, i) =>
    `${i+1}. R${r.room} | prompt="${(r.prompt ?? '').slice(0, 110)}" | chose="${(r.label ?? '').slice(0, 110)}" | pre-label=${r.primary_defense ?? '?'}${r.secondary_defense ? '/' + r.secondary_defense : ''}`
  ).join('\n')
  const journalsBlock = jrns.length === 0 ? '(none)' : jrns.map((j, i) => {
    const tag = isSilent(j.response) ? '[SILENT — sentinel · or empty]' : ''
    return `${i+1}. R${j.from_room} | prompt="${(j.prompt ?? '').slice(0, 110)}"\n   response: ${tag} ${(j.response ?? '').slice(0, 400).replace(/\n/g, ' ')}`
  }).join('\n\n')

  const sys = SYSTEM_PROMPT_TEMPLATE.replace('__CODEBOOK__', CODEBOOK_BLOCK)
  const user = [
    `DATA DENSITY: ${density} (n_choices=${logs.length}, n_journals_written=${nWritten}, n_journals_silent=${nSilent})`,
    '',
    'CHOICES (pre-labeled):',
    choicesBlock,
    '',
    'JOURNALS (raw, label these):',
    journalsBlock,
    '',
    'Now call the submit_session_analysis tool with the unified analysis.',
  ].join('\n')

  // 3) Claude 호출 — tool_use enum 으로 28 defense 표기 흐트러짐 자체 차단.
  //    sys 와 user 는 DB 에서 읽어온 journal/narrative 텍스트를 포함하므로 lone
  //    UTF-16 surrogate 가 섞일 수 있음 (Anthropic JSON 파서가 strict reject).
  //    source string + post-stringify body 모두 정화.
  const cleanSys  = stripLoneSurrogates(sys)
  const cleanUser = stripLoneSurrogates(user)
  const aiRes = await fetch(ANTHROPIC_URL, {
    method: 'POST',
    headers: { 'content-type': 'application/json', 'x-api-key': anthropicKey, 'anthropic-version': '2023-06-01' },
    body: buildAnthropicBody({
      model: MODEL_VERSION, max_tokens: 2048, system: cleanSys,
      tools: [ANALYSIS_TOOL],
      tool_choice: { type: 'tool', name: ANALYSIS_TOOL.name },
      messages: [{ role: 'user', content: cleanUser }],
    }),
  })
  if (!aiRes.ok) {
    const detail = (await aiRes.text()).slice(0, 400)
    return { error: 'anthropic failed: ' + detail, status: 502 }
  }
  const aiJson = await aiRes.json() as {
    content?: Array<{ type: string; name?: string; input?: Record<string, unknown> }>
  }
  const toolBlock = (aiJson.content ?? []).find(c => c.type === 'tool_use' && c.name === ANALYSIS_TOOL.name)
  if (!toolBlock || !toolBlock.input) {
    return { error: 'no tool_use block in response', status: 502 }
  }
  const parsed = toolBlock.input
  if (typeof parsed.primary_defense !== 'string' || !parsed.primary_defense) {
    return { error: 'invalid analysis: missing primary_defense', status: 502 }
  }

  // 4) array-of-objects → dict 변환 (DB 는 dict 으로 저장 — downstream 코드와 호환)
  const weightsArr = Array.isArray(parsed.defense_weights)
    ? parsed.defense_weights as Array<{ defense: string; weight: number }> : []
  const defense_weights: Record<string, number> = {}
  for (const e of weightsArr) {
    if (e && typeof e.defense === 'string' && typeof e.weight === 'number') defense_weights[e.defense] = e.weight
  }
  const evidenceArr = Array.isArray(parsed.evidence)
    ? parsed.evidence as Array<{ defense: string; citations: Array<{ source: 'choice' | 'journal'; room: number; snippet: string }> }> : []
  const evidence: SessionAnalysisRow['evidence'] = {}
  for (const e of evidenceArr) {
    if (e && typeof e.defense === 'string' && Array.isArray(e.citations)) evidence[e.defense] = e.citations
  }

  const top3 = Array.isArray(parsed.top_3) ? (parsed.top_3 as string[]).slice(0, 3) : [parsed.primary_defense as string]
  const row: SessionAnalysisRow = {
    session_id: sessionId,
    player_id:  playerId,
    primary_defense:   parsed.primary_defense as string,
    secondary_defense: typeof parsed.secondary_defense === 'string' ? parsed.secondary_defense : null,
    top_3:             top3,
    defense_weights,
    vaillant_profile:  (parsed.vaillant_profile as SessionAnalysisRow['vaillant_profile']) ?? { mature: 0, neurotic: 0, immature: 0, psychotic: 0 },
    evidence,
    summary:           typeof parsed.summary === 'string' ? parsed.summary : null,
    n_choices:         logs.length,
    n_journals:        jrns.length,
    n_silent_journals: nSilent,
    data_density:      density,
    model_version:     MODEL_VERSION,
    schema_version:    SCHEMA_VERSION,
  }
  const up = await sup.from('session_analysis').upsert(row, { onConflict: 'session_id' })
  if (up.error) return { error: 'session_analysis upsert: ' + up.error.message, status: 500 }
  return { row, cached: false }
}

// Output 표기/형식은 ANALYSIS_TOOL 의 input_schema 가 강제하므로 시스템 프롬프트는
// 의미적 가이드라인 (코덱북 + 라벨링 규칙) 만 담는다. 28 enum / JSON 모양 / 키
// 이름 같은 syntactic 제약은 schema 가 처리.
const SYSTEM_PROMPT_TEMPLATE = [
  "You are a clinical defense-mechanism labeler for a journaling RPG.",
  "Given a player's choices (already pre-labeled with defenses) and their",
  "free-text journal responses (NOT yet labeled), produce ONE unified defense",
  "profile for the entire session by calling the submit_session_analysis tool.",
  "",
  "CODEBOOK (28 defenses — these are the only valid labels):",
  "__CODEBOOK__",
  "",
  "RULES:",
  "  - Treat journal-response sentinel '\u00b7' or blank as STRONG signal — usually",
  "    Suppression, Isolation of Affect, or Apathetic Withdrawal. Do NOT",
  "    discard. Cite the silence itself as evidence (snippet=\"[silent]\").",
  "  - Pre-labeled choice defenses are reliable priors but the journal text is",
  "    the richer projective surface. Weigh both.",
  "  - Even when data is sparse/minimal, ALWAYS produce your best estimate and",
  "    set confidence_level=\"low\". Never refuse.",
  "  - defense_weights should sum to ~1.0 across up to 5 defenses.",
  "  - vaillant_profile values must sum to 1.0.",
  "  - For evidence, prefer short verbatim quotes (≤140 chars) over paraphrase.",
].join('\n')
