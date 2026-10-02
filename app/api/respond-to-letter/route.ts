// /api/respond-to-letter
//   POST { session_id, reply_text, player_id? }
//     → persists the player's private reply to the received letter
//       onto letter_exchanges.reply_text + reply_at.
//   Requires letter_exchanges.received_letter_id to already exist
//   (set by /api/letter). Returns 409 otherwise.
//   reply_text NEVER enters seed_letters. The future-pool path is
//   /api/compose-letter + /api/share-letter, which write a separate
//   composed_letter column.
//   Idempotent: re-calling overwrites reply_text and bumps reply_at.
//   Distinct from /api/letter-reply, which is the external QR path
//   for strangers replying to a shared letter.
import { createClient } from '@supabase/supabase-js'

export const dynamic = 'force-dynamic'

interface PostBody {
  session_id: string
  reply_text: string
  player_id?: string | null
}

export async function POST(request: Request) {
  const url    = process.env.NEXT_PUBLIC_SUPABASE_URL
  const secret = process.env.SUPABASE_SECRET_KEY
  if (!url || !secret) return Response.json({ error: 'server env missing' }, { status: 500 })

  let body: PostBody
  try { body = await request.json() }
  catch { return Response.json({ error: 'invalid json' }, { status: 400 }) }
  if (!body.session_id) {
    return Response.json({ error: 'session_id required' }, { status: 400 })
  }
  if (typeof body.reply_text !== 'string' || !body.reply_text.trim()) {
    return Response.json({ error: 'reply_text required' }, { status: 400 })
  }
  const reply = body.reply_text.trim().slice(0, 4000)

  const sup = createClient(url, secret, { auth: { persistSession: false, autoRefreshToken: false } })

  // Gate: a received letter must have been pinned first.
  const { data: ex, error: exErr } = await sup
    .from('letter_exchanges')
    .select('received_letter_id')
    .eq('session_id', body.session_id)
    .maybeSingle()
  if (exErr) return Response.json({ error: 'letter_exchanges read failed: ' + exErr.message }, { status: 500 })
  if (!ex || !ex.received_letter_id) {
    return Response.json({ error: 'receive a letter before replying' }, { status: 409 })
  }

  const { error: upErr } = await sup
    .from('letter_exchanges')
    .update({
      reply_text: reply,
      reply_at:   new Date().toISOString(),
      player_id:  body.player_id ?? null,
    })
    .eq('session_id', body.session_id)
  if (upErr) return Response.json({ error: 'letter_exchanges update failed: ' + upErr.message }, { status: 500 })

  return Response.json({ ok: true })
}
