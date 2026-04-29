// /letter/[id]
//   Public landing reached by scanning the talisman card's QR.
//   Server component: fetches every active letter in the pool +
//   joins generated_cards images via origin_session_id, then hands
//   the whole set to <LetterGallery>. The focused id from the URL
//   is the card that opens initially; everything else is browsable.
import { createClient } from '@supabase/supabase-js'
import { notFound } from 'next/navigation'
import LetterGallery, { type GalleryLetter } from '@/components/LetterGallery'

export const dynamic = 'force-dynamic'

interface PageProps {
  params: Promise<{ id: string }>
}

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

interface SeedRow {
  id:                string
  letter_text:       string
  primary_defense:   string
  author_pseudonym:  string | null
  source:            string
  origin_player_id:  string | null
  origin_session_id: string | null
  blank_answer:      string | null
  created_at:        string
}
interface CardRow {
  session_id: string
  image_url:  string | null
}

export default async function LetterPage({ params }: PageProps) {
  const { id } = await params
  if (!UUID_RE.test(id)) notFound()

  const url    = process.env.NEXT_PUBLIC_SUPABASE_URL
  const secret = process.env.SUPABASE_SECRET_KEY
  if (!url || !secret) {
    return <div className="p-10 text-stone-700">server env missing</div>
  }
  const sup = createClient(url, secret, { auth: { persistSession: false, autoRefreshToken: false } })

  const { data: rows, error } = await sup
    .from('seed_letters')
    .select('id, letter_text, primary_defense, author_pseudonym, source, ' +
            'origin_player_id, origin_session_id, blank_answer, created_at')
    .eq('active', true)
    .order('created_at', { ascending: true })
  if (error) return <div className="p-10 text-red-700/80">{error.message}</div>
  const letters = (rows ?? []) as unknown as SeedRow[]
  if (!letters.find((l) => l.id === id)) notFound()

  const sessionIds = letters
    .map((l) => l.origin_session_id)
    .filter((s): s is string => !!s)
  let images: Record<string, string> = {}
  if (sessionIds.length > 0) {
    const { data: cards } = await sup
      .from('generated_cards')
      .select('session_id, image_url')
      .in('session_id', sessionIds)
    images = Object.fromEntries(
      ((cards ?? []) as unknown as CardRow[])
        .filter((c) => !!c.image_url)
        .map((c) => [c.session_id, c.image_url as string]),
    )
  }

  const gallery: GalleryLetter[] = letters.map((l) => ({
    id:               l.id,
    letterText:       l.letter_text,
    primaryDefense:   l.primary_defense,
    authorPseudonym:  l.author_pseudonym,
    source:           (l.source === 'player' ? 'player' : 'seed'),
    originPlayerId:   l.origin_player_id,
    blankAnswer:      l.blank_answer,
    createdAt:        l.created_at,
    imageUrl:         l.origin_session_id ? (images[l.origin_session_id] ?? null) : null,
  }))

  return <LetterGallery letters={gallery} focusedId={id} />
}
