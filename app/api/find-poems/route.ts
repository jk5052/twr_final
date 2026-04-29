// /api/find-poems
//   POST { session_id }
//     1) reads blank_fill_responses.answer_embedding + primary_defense
//     2) calls match_poems RPC (defense_filter=primary_defense, top-1)
//     3) falls back to no-filter top-1 if defense filter returns nothing
//   Returns the matched poem snapshot for the talisman card.
import { createClient } from '@supabase/supabase-js'

export const dynamic = 'force-dynamic'

interface PostBody { session_id: string }

interface PoemRow {
  id:               number
  poem_name:        string
  author:           string | null
  content:          string
  primary_defense:  string | null
  intensity:        number | null
  stance:           string | null
  similarity:       number
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

  const { data: bfr, error: bfrErr } = await sup
    .from('blank_fill_responses')
    .select('primary_defense, answer_embedding')
    .eq('session_id', body.session_id)
    .maybeSingle()
  if (bfrErr) return Response.json({ error: 'blank_fill_responses read failed: ' + bfrErr.message }, { status: 500 })
  if (!bfr || !bfr.answer_embedding) {
    return Response.json({ error: 'no answer_embedding for session (run blank_fill first)' }, { status: 409 })
  }

  // try defense-filtered first; if nothing comes back, retry unfiltered.
  async function callMatch(defense: string | null) {
    return sup.rpc('match_poems', {
      query_embedding: bfr!.answer_embedding,
      match_threshold: 0.0,
      match_count:     1,
      defense_filter:  defense,
    })
  }

  let { data, error } = await callMatch(bfr.primary_defense ?? null)
  if (error) return Response.json({ error: 'match_poems rpc failed: ' + error.message }, { status: 500 })
  if (!data || (data as PoemRow[]).length === 0) {
    ;({ data, error } = await callMatch(null))
    if (error) return Response.json({ error: 'match_poems fallback failed: ' + error.message }, { status: 500 })
  }
  const top = (data as PoemRow[] | null)?.[0]
  if (!top) return Response.json({ error: 'no poem matched' }, { status: 404 })

  return Response.json({
    poem_id:         top.id,
    poem_name:       top.poem_name,
    author:          top.author,
    content:         top.content,
    primary_defense: top.primary_defense,
    intensity:       top.intensity,
    stance:          top.stance,
    similarity:      top.similarity,
  })
}
