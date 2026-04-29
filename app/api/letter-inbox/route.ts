// /api/letter-inbox
//   GET ?letter_id=<uuid>&player_id=<persistent>
//     returns replies if the requester's player_id matches the
//     seed_letter's origin_player_id. Marks fetched replies
//     delivered=true (best effort) on success.
import { createClient } from '@supabase/supabase-js'

export const dynamic = 'force-dynamic'

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

interface ReplyRow {
  id:           number
  reply_text:   string
  delivered:    boolean
  created_at:   string
}

export async function GET(request: Request) {
  const url    = process.env.NEXT_PUBLIC_SUPABASE_URL
  const secret = process.env.SUPABASE_SECRET_KEY
  if (!url || !secret) return Response.json({ error: 'server env missing' }, { status: 500 })

  const params    = new URL(request.url).searchParams
  const letter_id = params.get('letter_id') ?? ''
  const player_id = params.get('player_id') ?? ''
  if (!letter_id || !UUID_RE.test(letter_id)) {
    return Response.json({ error: 'letter_id (uuid) required' }, { status: 400 })
  }
  if (!player_id) {
    return Response.json({ error: 'player_id required' }, { status: 400 })
  }

  const sup = createClient(url, secret, { auth: { persistSession: false, autoRefreshToken: false } })

  const { data: letter, error: lErr } = await sup
    .from('seed_letters')
    .select('id, origin_player_id, primary_defense, letter_text')
    .eq('id', letter_id)
    .maybeSingle()
  if (lErr)    return Response.json({ error: 'seed_letters read failed: ' + lErr.message }, { status: 500 })
  if (!letter) return Response.json({ error: 'letter not found' }, { status: 404 })
  if ((letter.origin_player_id ?? '') !== player_id) {
    return Response.json({ error: 'not the author' }, { status: 403 })
  }

  const { data: rows, error: rErr } = await sup
    .from('letter_replies')
    .select('id, reply_text, delivered, created_at')
    .eq('shared_letter_id', letter_id)
    .order('created_at', { ascending: false })
    .limit(200)
  if (rErr) return Response.json({ error: 'letter_replies read failed: ' + rErr.message }, { status: 500 })

  const replies = (rows ?? []) as ReplyRow[]
  const undelivered = replies.filter(r => !r.delivered).map(r => r.id)
  if (undelivered.length > 0) {
    await sup.from('letter_replies').update({ delivered: true }).in('id', undelivered)
  }

  return Response.json({
    letter: {
      id:               letter.id,
      letter_text:      letter.letter_text,
      primary_defense:  letter.primary_defense,
    },
    replies,
    new_count: undelivered.length,
  })
}
