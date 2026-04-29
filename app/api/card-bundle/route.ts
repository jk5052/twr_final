// /api/card-bundle
//   POST { session_id, player_id?, from_room? }
//     Idempotent assembler for the talisman card. Reads (or creates,
//     once) the generated_cards row, fills in card_poem via
//     journal-prompt, pins qr_url from a shared letter (if any),
//     and returns everything the PDF needs — including a base64
//     QR data URL ready for <Image src=…>.
import { createClient, type SupabaseClient } from '@supabase/supabase-js'
import QRCode from 'qrcode'

export const dynamic = 'force-dynamic'
export const maxDuration = 60

interface PostBody {
  session_id: string
  player_id?: string | null
  from_room?: number
}

interface BfrRow {
  primary_defense: string | null
  answer:          string | null
}
interface ExRow {
  reply_text:        string | null
  reply_letter_id:   string | null
}
interface CardRow {
  image_url:        string | null
  card_poem:        string | null
  card_poem_title:  string | null
  card_poem_author: string | null
  qr_url:           string | null
  positive_framing: string | null
  primary_defense:  string | null
}

function buildQrUrl(letterId: string, origin: string): string {
  const base = (process.env.NEXT_PUBLIC_BASE_URL ?? '').replace(/\/+$/, '')
  return `${base || origin}/letter/${letterId}`
}

// @react-pdf/image accepts jpg/png/svg only — older sessions may hold a
// .webp url; treat those as stale and let the row regenerate.
function isPdfSafeImage(u: string | null | undefined): boolean {
  if (!u) return false
  const lower = u.split('?')[0].toLowerCase()
  return /\.(png|jpe?g|svg)$/.test(lower)
}

async function readCard(sup: SupabaseClient, sid: string): Promise<CardRow | null> {
  const { data, error } = await sup.from('generated_cards')
    .select('image_url, card_poem, card_poem_title, card_poem_author, qr_url, positive_framing, primary_defense')
    .eq('session_id', sid)
    .maybeSingle()
  if (error) throw new Error('generated_cards read failed: ' + error.message)
  return (data as CardRow | null) ?? null
}

export async function POST(request: Request) {
  const url    = process.env.NEXT_PUBLIC_SUPABASE_URL
  const secret = process.env.SUPABASE_SECRET_KEY
  if (!url || !secret) return Response.json({ error: 'server env missing' }, { status: 500 })

  let body: PostBody
  try { body = await request.json() }
  catch { return Response.json({ error: 'invalid json' }, { status: 400 }) }
  if (!body.session_id) return Response.json({ error: 'session_id required' }, { status: 400 })

  const sup = createClient(url, secret, { auth: { persistSession: false, autoRefreshToken: false } })
  const origin = new URL(request.url).origin

  const { data: bfr, error: bfrErr } = await sup
    .from('blank_fill_responses')
    .select('primary_defense, answer')
    .eq('session_id', body.session_id)
    .maybeSingle()
  if (bfrErr) return Response.json({ error: 'blank_fill_responses read failed: ' + bfrErr.message }, { status: 500 })
  if (!bfr || !bfr.primary_defense) {
    return Response.json({ error: 'blank_fill missing primary_defense (cannot card)' }, { status: 409 })
  }
  const { primary_defense, answer } = bfr as BfrRow

  const { data: ex } = await sup
    .from('letter_exchanges')
    .select('reply_text, reply_letter_id')
    .eq('session_id', body.session_id)
    .maybeSingle()
  const exch = (ex as ExRow | null) ?? null

  // 1) image — call /api/generate-card once if no row yet (or if the
  // existing image_url is a format the PDF renderer can't decode).
  let card = await readCard(sup, body.session_id)
  if (!card || !card.image_url || !isPdfSafeImage(card.image_url)) {
    if (card && card.image_url && !isPdfSafeImage(card.image_url)) {
      // wipe the stale row so generate-card can re-insert
      await sup.from('generated_cards').delete().eq('session_id', body.session_id)
    }
    const gcRes = await fetch(`${origin}/api/generate-card`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        session_id:      body.session_id,
        player_id:       body.player_id ?? null,
        primary_defense,
        blank_answer:    answer,
      }),
    })
    if (!gcRes.ok) {
      const t = await gcRes.text()
      return Response.json({ error: 'generate-card failed', detail: t.slice(0, 400) }, { status: 502 })
    }
    card = await readCard(sup, body.session_id)
    if (!card || !card.image_url) {
      return Response.json({ error: 'card row missing after generation' }, { status: 500 })
    }
  }

  // 2) poem — match a curated poem from poems_rag against the player's
  // own answer_embedding (filtered by primary_defense). Snapshot title +
  // author + content onto generated_cards so the second card page is
  // reproducible.
  if (!card.card_poem) {
    const fpRes = await fetch(`${origin}/api/find-poems`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ session_id: body.session_id }),
    })
    if (fpRes.ok) {
      const j = await fpRes.json() as {
        poem_name?: string; author?: string | null; content?: string
      }
      if (j.content && j.poem_name) {
        await sup.from('generated_cards')
          .update({
            card_poem:        j.content,
            card_poem_title:  j.poem_name,
            card_poem_author: j.author ?? null,
          })
          .eq('session_id', body.session_id)
        card.card_poem        = j.content
        card.card_poem_title  = j.poem_name
        card.card_poem_author = j.author ?? null
      }
    }
  }

  // 3) qr — pin url if a shared letter exists
  let qrUrl = card.qr_url ?? null
  if (!qrUrl && exch?.reply_letter_id) {
    qrUrl = buildQrUrl(exch.reply_letter_id, origin)
    await sup.from('generated_cards')
      .update({ qr_url: qrUrl })
      .eq('session_id', body.session_id)
  }

  let qrDataUrl: string | null = null
  if (qrUrl) {
    qrDataUrl = await QRCode.toDataURL(qrUrl, { margin: 1, scale: 6, errorCorrectionLevel: 'M' })
  }

  return Response.json({
    image_url:        card.image_url,
    primary_defense:  card.primary_defense ?? primary_defense,
    positive_framing: card.positive_framing ?? null,
    blank_answer:     answer,
    reply_text:       exch?.reply_text ?? null,
    card_poem:        card.card_poem ?? null,
    card_poem_title:  card.card_poem_title ?? null,
    card_poem_author: card.card_poem_author ?? null,
    qr_url:           qrUrl,
    qr_data_url:      qrDataUrl,
    shared:           !!exch?.reply_letter_id,
  })
}
