// /api/letter-reply
//   POST { letter_id, reply_text, reply_player_id?, reply_session_id? }
//     external response to a shared letter via QR scan.
//     stored in letter_replies (delivered=false). The author sees
//     these via /api/letter-inbox.
import { createClient } from '@supabase/supabase-js'

export const dynamic = 'force-dynamic'

interface PostBody {
  letter_id:         string
  reply_text:        string
  reply_player_id?:  string | null
  reply_session_id?: string | null
}

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

export async function POST(request: Request) {
  const url    = process.env.NEXT_PUBLIC_SUPABASE_URL
  const secret = process.env.SUPABASE_SECRET_KEY
  if (!url || !secret) return Response.json({ error: 'server env missing' }, { status: 500 })

  let body: PostBody
  try { body = await request.json() }
  catch { return Response.json({ error: 'invalid json' }, { status: 400 }) }

  if (!body.letter_id || !UUID_RE.test(body.letter_id)) {
    return Response.json({ error: 'letter_id (uuid) required' }, { status: 400 })
  }
  if (typeof body.reply_text !== 'string' || !body.reply_text.trim()) {
    return Response.json({ error: 'reply_text required' }, { status: 400 })
  }
  const reply = body.reply_text.trim().slice(0, 4000)

  const sup = createClient(url, secret, { auth: { persistSession: false, autoRefreshToken: false } })

  // confirm letter exists and is active
  const { data: letter, error: lErr } = await sup
    .from('seed_letters')
    .select('id, active')
    .eq('id', body.letter_id)
    .maybeSingle()
  if (lErr)             return Response.json({ error: 'seed_letters read failed: ' + lErr.message }, { status: 500 })
  if (!letter)          return Response.json({ error: 'letter not found' }, { status: 404 })
  if (!letter.active)   return Response.json({ error: 'letter inactive' }, { status: 410 })

  const reply_session_id = body.reply_session_id && UUID_RE.test(body.reply_session_id)
    ? body.reply_session_id
    : null

  const { error: insErr } = await sup.from('letter_replies').insert({
    shared_letter_id: body.letter_id,
    reply_text:       reply,
    reply_player_id:  body.reply_player_id ?? null,
    reply_session_id,
  })
  if (insErr) return Response.json({ error: 'letter_replies insert failed: ' + insErr.message }, { status: 500 })

  return Response.json({ ok: true })
}
