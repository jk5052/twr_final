'use client'
import { useEffect, useRef, useState } from 'react'
import { getPlayerId, getSessionId } from '@/lib/session'
import type { GalleryLetter } from '@/components/LetterGallery'

// Floating museum-style detail panel. Renders any clicked letter
// in read-only mode. Reply form / author inbox only show on the
// focused letter (the one whose id is in the URL).

interface InboxReply {
  id:         number
  reply_text: string
  delivered:  boolean
  created_at: string
}

interface Props {
  letter:     GalleryLetter
  isFocused:  boolean
  onClose:    () => void
}

export default function LetterDetailCard({ letter, isFocused, onClose }: Props) {
  const [mode, setMode] = useState<'pending' | 'author' | 'stranger'>('pending')
  const [inbox, setInbox] = useState<InboxReply[] | null>(null)
  const [reply, setReply] = useState('')
  const [submitting, setSubmitting] = useState(false)
  const [sent, setSent] = useState(false)
  const [letItBe, setLetItBe] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const fetchedInbox = useRef(false)

  useEffect(() => {
    if (!isFocused) { setMode('pending'); return }
    const me = getPlayerId()
    setMode(letter.originPlayerId && me === letter.originPlayerId ? 'author' : 'stranger')
  }, [isFocused, letter.originPlayerId])

  useEffect(() => {
    if (mode !== 'author' || fetchedInbox.current) return
    fetchedInbox.current = true
    void (async () => {
      try {
        const r = await fetch(`/api/letter-inbox?letter_id=${encodeURIComponent(letter.id)}` +
          `&player_id=${encodeURIComponent(getPlayerId())}`)
        if (!r.ok) { setError((await r.text()).slice(0, 200)); return }
        const j = await r.json() as { replies: InboxReply[] }
        setInbox(j.replies)
      } catch (e) { setError(String(e).slice(0, 200)) }
    })()
  }, [mode, letter.id])

  async function send() {
    if (submitting || sent) return
    const txt = reply.trim()
    if (!txt) return
    setSubmitting(true); setError(null)
    try {
      const r = await fetch('/api/letter-reply', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          letter_id: letter.id, reply_text: txt,
          reply_player_id: getPlayerId(), reply_session_id: getSessionId(),
        }),
      })
      if (!r.ok) { setError((await r.text()).slice(0, 200)); return }
      setSent(true)
    } catch (e) { setError(String(e).slice(0, 200)) }
    finally { setSubmitting(false) }
  }

  const date = new Date(letter.createdAt).toLocaleDateString('en-US',
    { month: 'long', year: 'numeric' })
  const author = letter.authorPseudonym
    ? letter.authorPseudonym
    : letter.source === 'player' ? 'a stranger who has been here' : 'a stranger'

  return (
    <div className="fixed inset-0 z-40 flex items-start justify-center
      px-4 pt-16 pb-8 overflow-y-auto" onClick={onClose}>
      <div className="absolute inset-0 bg-stone-900/8 backdrop-blur-[0.5px]" />
      <div onClick={(e) => e.stopPropagation()}
        className="relative w-full max-w-md bg-[#fbf7ee] shadow-[0_30px_80px_-20px_rgba(0,0,0,0.45)]
          border border-stone-200 flex flex-col">
        <button onClick={onClose} aria-label="close"
          className="absolute top-2 right-2 z-10 w-7 h-7 flex items-center justify-center
            text-stone-500 hover:text-stone-900 transition-colors text-base leading-none">×</button>

        {letter.imageUrl ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img src={letter.imageUrl} alt=""
            className="w-full h-44 object-cover bg-stone-200" />
        ) : (
          <div className="w-full h-20 bg-[#ede4d2] border-b border-stone-200
            flex items-center justify-center">
            <span className="text-stone-400 text-[10px] tracking-[0.3em] uppercase">
              an unsent letter
            </span>
          </div>
        )}

        <div className="px-5 pt-4 pb-3 border-b border-stone-200">
          <p className="text-stone-900 text-base font-serif italic">{author}</p>
          <p className="text-stone-500 text-xs mt-0.5">
            {letter.blankAnswer ? `“${letter.blankAnswer}”` : 'undefined'}
          </p>
          <p className="text-stone-400 text-[11px] mt-0.5">{date}</p>
        </div>

        <div className="px-5 py-4 border-b border-stone-200">
          <p className="text-stone-800 text-sm leading-relaxed font-serif whitespace-pre-wrap">
            {letter.letterText}
          </p>
        </div>

        <dl className="px-5 py-3 grid grid-cols-[88px_1fr] gap-y-1.5 gap-x-3
          text-[11px] border-b border-stone-200">
          <dt className="text-stone-400 uppercase tracking-[0.15em]">Classification</dt>
          <dd className="text-stone-700">{letter.primaryDefense}</dd>
          <dt className="text-stone-400 uppercase tracking-[0.15em]">Source</dt>
          <dd className="text-stone-700">{letter.source === 'player' ? 'player letter' : 'seed letter'}</dd>
          <dt className="text-stone-400 uppercase tracking-[0.15em]">Sent</dt>
          <dd className="text-stone-700">{date}</dd>
        </dl>

        {isFocused && (
          <FocusedActions
            mode={mode} inbox={inbox} reply={reply} sent={sent}
            letItBe={letItBe} submitting={submitting} error={error}
            onChange={setReply} onSend={send}
            onLetItBe={() => setLetItBe(true)}
          />
        )}
      </div>
    </div>
  )
}

interface ActionsProps {
  mode:        'pending' | 'author' | 'stranger'
  inbox:       InboxReply[] | null
  reply:       string
  sent:        boolean
  letItBe:     boolean
  submitting:  boolean
  error:       string | null
  onChange:    (s: string) => void
  onSend:      () => void
  onLetItBe:   () => void
}

function FocusedActions(p: ActionsProps) {
  if (p.mode === 'pending') return null

  if (p.mode === 'author') {
    return (
      <section className="px-5 py-4 flex flex-col gap-3">
        <h3 className="text-stone-400 text-[10px] tracking-[0.3em] uppercase">your inbox</h3>
        {p.inbox === null && !p.error && (
          <p className="text-stone-400 text-xs italic animate-pulse">opening…</p>
        )}
        {p.inbox && p.inbox.length === 0 && (
          <p className="text-stone-400 text-xs italic">no replies yet.</p>
        )}
        {p.inbox && p.inbox.length > 0 && (
          <ul className="flex flex-col gap-4">
            {p.inbox.map((r) => (
              <li key={r.id} className="flex flex-col gap-1">
                <p className="text-stone-800 text-sm font-serif leading-relaxed whitespace-pre-wrap">
                  {r.reply_text}
                </p>
                <p className="text-stone-400 text-[10px] tracking-widest uppercase">
                  {new Date(r.created_at).toLocaleString()}
                  {!r.delivered && ' · new'}
                </p>
              </li>
            ))}
          </ul>
        )}
        {p.error && <p className="text-red-700/70 text-xs">failed: {p.error}</p>}
      </section>
    )
  }

  // stranger view — silent let-it-be never hits the DB; the author's
  // inbox stays uncluttered, and silence is held privately.
  if (p.letItBe) {
    return (
      <section className="px-5 py-6 flex flex-col items-center gap-3">
        <p className="text-stone-500 text-2xl font-serif italic select-none">·</p>
        <p className="text-stone-400 text-[10px] tracking-[0.3em] uppercase text-center">
          your silence has been kept.
        </p>
      </section>
    )
  }

  return (
    <section className="px-5 py-4 flex flex-col gap-3">
      <h3 className="text-stone-400 text-[10px] tracking-[0.3em] uppercase">if this were you.</h3>
      {p.sent ? (
        <p className="text-stone-700 text-sm italic font-serif">your reply has been sent.</p>
      ) : (
        <>
          <textarea value={p.reply} onChange={(e) => p.onChange(e.target.value)}
            placeholder="write back, or let it be."
            rows={4} disabled={p.submitting}
            className="w-full bg-[#fffaf0] border border-stone-300 text-stone-800
              text-sm font-serif leading-relaxed p-3 outline-none
              focus:border-stone-600 transition-colors resize-none
              placeholder:text-stone-400 disabled:opacity-40" />
          <div className="flex justify-end gap-2">
            <button onClick={p.onLetItBe}
              disabled={p.submitting || !!p.reply.trim()}
              title="leave the letter as it is — no reply"
              className="text-stone-500 text-[10px] tracking-[0.3em] uppercase
                px-4 py-2 border border-stone-300 hover:border-stone-600
                hover:text-stone-800 bg-transparent transition-colors
                disabled:opacity-25 disabled:cursor-not-allowed">let it be</button>
            <button onClick={p.onSend}
              disabled={p.submitting || !p.reply.trim()}
              className="text-stone-700 text-[10px] tracking-[0.3em] uppercase
                px-5 py-2 border border-stone-400 hover:border-stone-700
                bg-transparent transition-colors
                disabled:opacity-30 disabled:cursor-not-allowed">send</button>
          </div>
        </>
      )}
      {p.error && <p className="text-red-700/70 text-xs">failed: {p.error}</p>}
    </section>
  )
}
