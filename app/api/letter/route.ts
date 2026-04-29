// /api/letter
//   POST { session_id, player_id? }
//     → idempotent fetch/create of one matched letter for this session.
//       reads blank_fill_responses (embedding + defense), runs RPC
//       match_letter_for_session, falls back to *_any when needed,
//       and pins the choice in letter_exchanges.
//   POST { session_id, reply_text }
//     → save the player's reply onto the existing exchange row.
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

interface ExchangeRow {
  received_letter_id: string
  reply_text:         string | null
}

interface PostBody {
  session_id: string
  player_id?: string | null
  reply_text?: string
  let_it_be?: boolean        // true → save sentinel '·' in reply_text (silent ack)
}

// Single middle-dot — sentinel for "let it be" / silent acknowledgement.
// Distinct from NULL (= not yet replied) and from any real prose.
const LET_IT_BE = '\u00b7'

async function fetchMatch(sup: SupabaseClient, sessionId: string): Promise<MatchRow | null> {
  const { data, error } = await sup.rpc('match_letter_for_session', { p_session_id: sessionId })
  if (error) throw new Error('match_letter_for_session failed: ' + error.message)
  const rows = (data ?? []) as MatchRow[]
  if (rows.length > 0) return rows[0]
  // fallback — no candidate in same defense lane
  const { data: anyData, error: anyErr } = await sup.rpc('match_letter_for_session_any', { p_session_id: sessionId })
  if (anyErr) throw new Error('match_letter_for_session_any failed: ' + anyErr.message)
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

  // ── reply path ────────────────────────────────────────────────
  if (typeof body.reply_text === 'string' || body.let_it_be === true) {
    const reply = body.let_it_be === true
      ? LET_IT_BE
      : (body.reply_text ?? '').trim().slice(0, 4000)
    if (!reply) return Response.json({ error: 'reply_text empty' }, { status: 400 })

    const { data: ex, error: exErr } = await sup
      .from('letter_exchanges')
      .select('received_letter_id')
      .eq('session_id', body.session_id)
      .maybeSingle()
    if (exErr)  return Response.json({ error: 'letter_exchanges read failed: ' + exErr.message }, { status: 500 })
    if (!ex)    return Response.json({ error: 'no letter to reply to (call POST without reply_text first)' }, { status: 409 })

    const { error: upErr } = await sup
      .from('letter_exchanges')
      .update({ reply_text: reply, player_id: body.player_id ?? null })
      .eq('session_id', body.session_id)
    if (upErr) return Response.json({ error: 'reply save failed: ' + upErr.message }, { status: 500 })

    return Response.json({ ok: true, received_letter_id: ex.received_letter_id, let_it_be: reply === LET_IT_BE })
  }

  // ── match path (idempotent) ───────────────────────────────────
  const { data: existing, error: exErr } = await sup
    .from('letter_exchanges')
    .select('received_letter_id, reply_text')
    .eq('session_id', body.session_id)
    .maybeSingle()
  if (exErr) return Response.json({ error: 'letter_exchanges read failed: ' + exErr.message }, { status: 500 })

  if (existing) {
    const ex = existing as ExchangeRow
    const letter = await loadLetterById(sup, ex.received_letter_id)
    if (!letter) return Response.json({ error: 'pinned letter missing' }, { status: 500 })
    return Response.json({
      letter_id:        letter.letter_id,
      letter_text:      letter.letter_text,
      primary_defense:  letter.primary_defense,
      author_pseudonym: letter.author_pseudonym,
      source:           letter.source,
      similarity:       null,
      reply_text:       ex.reply_text ?? null,
      already_replied:  !!ex.reply_text,
    })
  }

  let match: MatchRow | null
  try { match = await fetchMatch(sup, body.session_id) }
  catch (e) { return Response.json({ error: String(e) }, { status: 500 }) }
  if (!match) return Response.json({ error: 'no candidate letter in pool' }, { status: 404 })

  const { error: insErr } = await sup.from('letter_exchanges').insert({
    session_id:         body.session_id,
    player_id:          body.player_id ?? null,
    received_letter_id: match.letter_id,
  })
  if (insErr) return Response.json({ error: 'letter_exchanges insert failed: ' + insErr.message }, { status: 500 })

  return Response.json({
    letter_id:        match.letter_id,
    letter_text:      match.letter_text,
    primary_defense:  match.primary_defense,
    author_pseudonym: match.author_pseudonym,
    source:           match.source,
    similarity:       match.similarity,
    reply_text:       null,
    already_replied:  false,
  })
}
