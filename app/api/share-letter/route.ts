// /api/share-letter
//   POST { session_id, share: boolean, player_id? }
//     share=true  → ingest the player's reply into seed_letters
//                   (source='player', reuses blank_answer embedding)
//                   via share_player_letter RPC; returns qr_url.
//     share=false → no-op; returns { shared:false }.
//   Idempotent — re-calling with share=true returns the existing
//   shared_letter_id (RPC handles this).
import { createClient } from '@supabase/supabase-js'

export const dynamic = 'force-dynamic'

interface PostBody {
  session_id: string
  share:      boolean
  player_id?: string | null
}

interface RpcRow { shared_letter_id: string }

function buildQrUrl(letterId: string, origin: string): string {
  const base = (process.env.NEXT_PUBLIC_BASE_URL ?? '').replace(/\/+$/, '')
  return `${base || origin}/letter/${letterId}`
}

export async function POST(request: Request) {
  const url    = process.env.NEXT_PUBLIC_SUPABASE_URL
  const secret = process.env.SUPABASE_SECRET_KEY
  if (!url || !secret) return Response.json({ error: 'server env missing' }, { status: 500 })

  let body: PostBody
  try { body = await request.json() }
  catch { return Response.json({ error: 'invalid json' }, { status: 400 }) }
  if (!body.session_id || typeof body.share !== 'boolean') {
    return Response.json({ error: 'session_id and share required' }, { status: 400 })
  }

  const sup = createClient(url, secret, { auth: { persistSession: false, autoRefreshToken: false } })
  const origin = new URL(request.url).origin

  // confirm a reply exists for this session
  const { data: ex, error: exErr } = await sup
    .from('letter_exchanges')
    .select('reply_text, reply_letter_id')
    .eq('session_id', body.session_id)
    .maybeSingle()
  if (exErr) return Response.json({ error: 'letter_exchanges read failed: ' + exErr.message }, { status: 500 })
  if (!ex || !ex.reply_text) {
    return Response.json({ error: 'no reply on file (POST /api/letter with reply_text first)' }, { status: 409 })
  }

  // let-it-be sentinel — never shareable, returns clean no-op.
  if (ex.reply_text === '\u00b7' || !body.share) {
    return Response.json({
      shared:           false,
      shared_letter_id: null,
      qr_url:           null,
    })
  }

  // RPC: insert into seed_letters + pin reply_letter_id (idempotent)
  const { data, error } = await sup.rpc('share_player_letter', {
    p_session_id: body.session_id,
    p_player_id:  body.player_id ?? null,
  })
  if (error) return Response.json({ error: 'share_player_letter rpc failed: ' + error.message }, { status: 500 })

  const rows = (data ?? []) as RpcRow[]
  const sharedLetterId = rows[0]?.shared_letter_id
  if (!sharedLetterId) {
    return Response.json({ error: 'share_player_letter returned no id' }, { status: 500 })
  }

  const qrUrl = buildQrUrl(sharedLetterId, origin)

  // best-effort: pin qr_url onto generated_cards if the row already exists
  await sup.from('generated_cards')
    .update({ qr_url: qrUrl })
    .eq('session_id', body.session_id)

  return Response.json({
    shared:           true,
    shared_letter_id: sharedLetterId,
    qr_url:           qrUrl,
  })
}
