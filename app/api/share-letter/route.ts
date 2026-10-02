// /api/share-letter
//   POST { session_id, share: boolean, player_id? }
//     Records the player's archive decision for the composed letter.
//     share=true  → set share_choice=true, then run share_player_letter
//                   RPC which inserts the composed letter into
//                   seed_letters (source='player'). Returns qr_url.
//     share=false → set share_choice=false; no insert into seed_letters,
//                   nothing enters the future matching pool.
//   Returns 409 if /api/compose-letter has not been called yet.
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

  // Gate: composed_letter must exist before a share decision can be recorded.
  const { data: ex, error: exErr } = await sup
    .from('letter_exchanges')
    .select('composed_letter, reply_letter_id')
    .eq('session_id', body.session_id)
    .maybeSingle()
  if (exErr) return Response.json({ error: 'letter_exchanges read failed: ' + exErr.message }, { status: 500 })
  if (!ex || !ex.composed_letter) {
    return Response.json({ error: 'compose-letter required first' }, { status: 409 })
  }

  // share=false → record the choice, no insert into seed_letters.
  if (!body.share) {
    const { error: upErr } = await sup
      .from('letter_exchanges')
      .update({ share_choice: false, player_id: body.player_id ?? null })
      .eq('session_id', body.session_id)
    if (upErr) return Response.json({ error: 'share_choice update failed: ' + upErr.message }, { status: 500 })
    return Response.json({
      shared:           false,
      shared_letter_id: null,
      qr_url:           null,
    })
  }

  // share=true → flip share_choice first so the RPC's guard passes.
  const { error: scErr } = await sup
    .from('letter_exchanges')
    .update({ share_choice: true, player_id: body.player_id ?? null })
    .eq('session_id', body.session_id)
  if (scErr) return Response.json({ error: 'share_choice update failed: ' + scErr.message }, { status: 500 })

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
