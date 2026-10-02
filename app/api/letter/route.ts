// /api/letter
//   POST { session_id, player_id? }
//     → compose-first. Runs after the player has written their own
//       letter (LetterComposeOverlay → /api/compose-letter), keying on
//       letter_exchanges.composed_letter_embedding via
//       match_letter_for_session_v2. Lane (primary_defense) still
//       comes from blank_fill_responses (mirrored by SealingOverlay).
//       Picks one matched seed letter, pins it onto
//       letter_exchanges.received_letter_id, returns it for display.
//   Idempotent: once received_letter_id is set, subsequent calls
//   return the same letter.
//   Returns 425 if letter_exchanges.composed_letter_embedding is not
//   ready yet (compose-letter still in flight on advance).
import { createClient, type SupabaseClient } from '@supabase/supabase-js'

export const dynamic = 'force-dynamic'

interface MatchRow {
  letter_id:        string
  letter_text:      string
  primary_defense:  string
  author_pseudonym: string | null
  source:           string
  blank_answer:     string | null
  similarity:       number
}

interface PostBody {
  session_id: string
  player_id?: string | null
}

async function fetchMatch(sup: SupabaseClient, sessionId: string): Promise<MatchRow | null> {
  const { data, error } = await sup.rpc('match_letter_for_session_v2', { p_session_id: sessionId })
  if (error) throw new Error('match_letter_for_session_v2 failed: ' + error.message)
  const rows = (data ?? []) as MatchRow[]
  if (rows.length > 0) return rows[0]
  const { data: anyData, error: anyErr } = await sup.rpc('match_letter_for_session_v2_any', { p_session_id: sessionId })
  if (anyErr) throw new Error('match_letter_for_session_v2_any failed: ' + anyErr.message)
  const anyRows = (anyData ?? []) as MatchRow[]
  return anyRows[0] ?? null
}

async function loadLetterById(sup: SupabaseClient, letterId: string): Promise<MatchRow | null> {
  const { data, error } = await sup
    .from('seed_letters')
    .select('id, letter_text, primary_defense, author_pseudonym, source, blank_answer')
    .eq('id', letterId)
    .maybeSingle()
  if (error) throw new Error('seed_letters read failed: ' + error.message)
  if (!data) return null
  return {
    letter_id:        data.id as string,
    letter_text:      data.letter_text as string,
    primary_defense:  data.primary_defense as string,
    author_pseudonym: (data.author_pseudonym as string | null) ?? null,
    source:           data.source as string,
    blank_answer:     (data.blank_answer as string | null) ?? null,
    similarity:       0,
  }
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

  const sup = createClient(url, secret, { auth: { persistSession: false, autoRefreshToken: false } })

  // Idempotent: if a match was already pinned, return the same letter.
  const { data: ex, error: exErr } = await sup
    .from('letter_exchanges')
    .select('received_letter_id, composed_letter_embedding')
    .eq('session_id', body.session_id)
    .maybeSingle()
  if (exErr) return Response.json({ error: 'letter_exchanges read failed: ' + exErr.message }, { status: 500 })

  if (ex && ex.received_letter_id) {
    const letter = await loadLetterById(sup, ex.received_letter_id as string)
    if (!letter) return Response.json({ error: 'pinned letter missing' }, { status: 500 })
    return Response.json({
      letter_id:        letter.letter_id,
      letter_text:      letter.letter_text,
      primary_defense:  letter.primary_defense,
      author_pseudonym: letter.author_pseudonym,
      source:           letter.source,
      similarity:       null,
    })
  }

  // Pre-flight: composed_letter_embedding must be present. The compose
  // submit is awaited on the client, but mirror this guard defensively
  // so the player gets a retryable 425 rather than a confusing 404
  // if the row is somehow incomplete.
  if (!ex || !ex.composed_letter_embedding) {
    return Response.json({ error: 'composed letter embedding not ready' }, { status: 425 })
  }

  let match: MatchRow | null
  try { match = await fetchMatch(sup, body.session_id) }
  catch (e) { return Response.json({ error: String(e) }, { status: 500 }) }
  if (!match) return Response.json({ error: 'no candidate letter in pool' }, { status: 404 })

  // Row already exists from /api/compose-letter — update in place so
  // composed_letter / embedding / share_choice / player_id are preserved.
  const { error: upErr } = await sup
    .from('letter_exchanges')
    .update({ received_letter_id: match.letter_id })
    .eq('session_id', body.session_id)
  if (upErr) return Response.json({ error: 'letter_exchanges update failed: ' + upErr.message }, { status: 500 })

  return Response.json({
    letter_id:        match.letter_id,
    letter_text:      match.letter_text,
    primary_defense:  match.primary_defense,
    author_pseudonym: match.author_pseudonym,
    source:           match.source,
    similarity:       match.similarity,
  })
}
