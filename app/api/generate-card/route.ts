// POST /api/generate-card
// 엔드게임에서 호출. primary_defense + (선택적) blank_answer / picked_words 를 받아
// Flux Schnell (Replicate) 로 talisman card 이미지를 생성하고
// generated_cards 테이블에 한 줄 insert 한 뒤 image_url 을 돌려준다.
// 클라이언트는 anon만 가지고 있으므로 Replicate 호출 + DB insert 는 모두 서버에서.
import { createClient } from '@supabase/supabase-js'
import framingMap from '@/data/defense_positive_framing.json'

export const dynamic = 'force-dynamic'
export const maxDuration = 60   // Flux Schnell sync wait 가 60s 내에 끝나야 함

const REPLICATE_URL =
  'https://api.replicate.com/v1/models/black-forest-labs/flux-schnell/predictions'
const IMAGE_PROVIDER = 'flux-schnell'
const MODEL_VERSION  = 'black-forest-labs/flux-schnell'
// Brother VC500W 라벨 카드 ≈ 50×76mm (2:3 portrait) — flux-schnell 의 aspect_ratio 와 일치
const ASPECT_RATIO = '2:3'
// PNG only — @react-pdf/image (4.x) sniffs magic bytes and accepts only
// jpg/png/svg. webp triggers "Not valid image extension" in the PDF.
const OUTPUT_FORMAT = 'png'
const MEGAPIXELS = '1'
const NUM_INFERENCE_STEPS = 4

interface CardRequest {
  session_id:       string
  player_id?:       string | null
  primary_defense:  string                    // one of 28 codebook names
  blank_answer?:    string | null             // 빈칸채우기 답 (선택)
  picked_words?:    string[]                  // 누적 오라클 픽 (선택)
}

type FramingEntry = { framing_en: string; image_seed: string }

export async function POST(request: Request) {
  const url       = process.env.NEXT_PUBLIC_SUPABASE_URL
  const secret    = process.env.SUPABASE_SECRET_KEY
  const replicate = process.env.REPLICATE_API_TOKEN
  if (!url || !secret) {
    return Response.json({ error: 'supabase env missing' }, { status: 500 })
  }
  if (!replicate) {
    return Response.json({ error: 'REPLICATE_API_TOKEN missing in .env.local' }, { status: 500 })
  }

  let body: CardRequest
  try {
    body = await request.json()
  } catch {
    return Response.json({ error: 'invalid json' }, { status: 400 })
  }
  if (!body.session_id || !body.primary_defense) {
    return Response.json({ error: 'session_id, primary_defense required' }, { status: 400 })
  }

  const framing = (framingMap as unknown as Record<string, FramingEntry>)[body.primary_defense]
  if (!framing || !framing.framing_en) {
    return Response.json(
      { error: `no framing entry for defense="${body.primary_defense}"` },
      { status: 400 },
    )
  }

  const blank = (body.blank_answer ?? '').trim()
  const words = (body.picked_words ?? [])
    .filter((w) => typeof w === 'string' && w.trim())
    .slice(0, 4)

  // 1) prompt build — tarot-card aesthetic: black silhouette / ink illustration
  // on warm ivory paper. single symbolic object, no faces, no text.
  const lines: string[] = [
    `tarot-style talisman card illustration of a single symbolic object: ${framing.image_seed}`,
    `quiet meaning: ${framing.framing_en}`,
  ]
  if (blank)         lines.push(`woven element: "${blank.slice(0, 120)}"`)
  if (words.length)  lines.push(`atmospheric anchors: ${words.map((w) => `"${w}"`).join(', ')}`)
  lines.push(
    'style: solid black silhouette and fine ink linework on a clean off-white ivory paper background,',
    'centered composition, generous negative space, subtle paper grain, vintage tarot card feel,',
    'flat 2D vector-like shapes, high contrast, two-tone (black on ivory) with optional muted sepia accent only,',
    'no humans, no faces, no figures, no text, no letters, no numerals, no logos, no threatening imagery,',
    'dignified, quiet, contemplative mood',
  )
  const promptUsed = lines.join('\n')

  // 2) Replicate 호출 (sync — Prefer: wait 로 결과 즉시 수신, 최대 60s)
  const replicateRes = await fetch(REPLICATE_URL, {
    method: 'POST',
    headers: {
      'authorization': `Bearer ${replicate}`,
      'content-type':  'application/json',
      'prefer':        'wait',
    },
    body: JSON.stringify({
      input: {
        prompt:               promptUsed,
        aspect_ratio:         ASPECT_RATIO,
        output_format:        OUTPUT_FORMAT,
        num_outputs:          1,
        megapixels:           MEGAPIXELS,
        num_inference_steps:  NUM_INFERENCE_STEPS,
        go_fast:              true,
        disable_safety_checker: false,
      },
    }),
  })

  if (!replicateRes.ok) {
    const errText = await replicateRes.text()
    return Response.json(
      { error: 'replicate failed', detail: errText.slice(0, 500) },
      { status: 502 },
    )
  }

  const pred = await replicateRes.json() as {
    id?: string; status?: string; output?: string[] | string; error?: string | null
  }
  if (pred.status && pred.status !== 'succeeded') {
    return Response.json(
      { error: 'replicate not succeeded', status: pred.status, detail: pred.error ?? null },
      { status: 502 },
    )
  }
  const imageUrl = Array.isArray(pred.output) ? pred.output[0] : pred.output
  if (!imageUrl || typeof imageUrl !== 'string') {
    return Response.json({ error: 'no image url from replicate' }, { status: 502 })
  }

  // 3) generated_cards insert (server-side, RLS off)
  const sup = createClient(url, secret, {
    auth: { persistSession: false, autoRefreshToken: false },
  })
  const { error: insErr } = await sup.from('generated_cards').insert({
    session_id:       body.session_id,
    player_id:        body.player_id ?? null,
    primary_defense:  body.primary_defense,
    positive_framing: framing.framing_en,
    blank_answer:     blank || null,
    picked_words:     words,
    prompt_used:      promptUsed,
    image_url:        imageUrl,
    image_provider:   IMAGE_PROVIDER,
    model_version:    MODEL_VERSION,
  })
  if (insErr) {
    console.warn('[generate-card] generated_cards insert failed:', insErr.message)
  }

  return Response.json({
    image_url:        imageUrl,
    primary_defense:  body.primary_defense,
    framing_en:       framing.framing_en,
    image_seed:       framing.image_seed,
    prompt_used:      promptUsed,
    image_provider:   IMAGE_PROVIDER,
    model_version:    MODEL_VERSION,
    db_saved:         !insErr,
  })
}
