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
  const [imgFailed, setImgFailed] = useState(false)
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
      <div className="absolute inset-0 bg-black/75 backdrop-blur-[2px]" />
      <div onClick={(e) => e.stopPropagation()}
        className="relative w-full max-w-lg bg-[#0a0a0a] shadow-[0_30px_80px_-20px_rgba(0,0,0,0.85)]
          border border-white/15 flex flex-col font-sans">
        <button onClick={onClose} aria-label="close"
          className="absolute top-2 right-2 z-10 w-7 h-7 flex items-center justify-center
            text-white/45 hover:text-white transition-colors text-base leading-none">×</button>

        {letter.imageUrl && !imgFailed ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img src={letter.imageUrl} alt=""
            className="w-full h-44 object-cover bg-stone-900"
            onError={() => setImgFailed(true)} />
        ) : (
          <div className="w-full h-20 bg-[#141414] border-b border-white/10
            flex items-center justify-center">
            <span className="text-white/35 text-[10px] tracking-[0.3em] uppercase">
              an unsent letter
            </span>
          </div>
        )}

        <div className="px-6 pt-5 pb-4 border-b border-white/10">
          <p className="text-white text-xl font-serif italic leading-tight">{author}</p>
          <p className="text-white/55 text-sm font-serif italic mt-1">
            {letter.blankAnswer ? `“${letter.blankAnswer}”` : 'undefined'}
          </p>
          <p className="text-white/35 text-[11px] tracking-[0.2em] uppercase mt-2">{date}</p>
        </div>

        <div className="px-6 py-6 border-b border-white/10">
          <p className="text-white/90 text-lg leading-[1.75] font-serif whitespace-pre-wrap">
            {letter.letterText}
          </p>
        </div>

        <dl className="px-6 py-4 grid grid-cols-[88px_1fr] gap-y-1.5 gap-x-3
          text-[11px] border-b border-white/10">
          <dt className="text-white/35 uppercase tracking-[0.15em]">Source</dt>
          <dd className="text-white/80">{letter.source === 'player' ? 'player letter' : 'seed letter'}</dd>
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
      <section className="px-6 py-5 flex flex-col gap-3">
        <h3 className="text-white/40 text-[10px] tracking-[0.3em] uppercase">your inbox</h3>
        {p.inbox === null && !p.error && (
          <p className="text-white/40 text-xs italic animate-pulse">opening…</p>
        )}
        {p.inbox && p.inbox.length === 0 && (
          <p className="text-white/40 text-xs italic">no replies yet.</p>
        )}
        {p.inbox && p.inbox.length > 0 && (
          <ul className="flex flex-col gap-5">
            {p.inbox.map((r) => (
              <li key={r.id} className="flex flex-col gap-1.5">
                <p className="text-white/90 text-lg font-serif leading-[1.75] whitespace-pre-wrap">
                  {r.reply_text}
                </p>
                <p className="text-white/35 text-[10px] tracking-widest uppercase">
                  {new Date(r.created_at).toLocaleString()}
                  {!r.delivered && ' · new'}
                </p>
              </li>
            ))}
          </ul>
        )}
        {p.error && <p className="text-red-400/80 text-xs">failed: {p.error}</p>}
      </section>
    )
  }

  // stranger view — silent let-it-be never hits the DB; the author's
  // inbox stays uncluttered, and silence is held privately.
  if (p.letItBe) {
    return (
      <section className="px-6 py-7 flex flex-col items-center gap-3">
        <p className="text-white/55 text-2xl font-serif italic select-none">·</p>
        <p className="text-white/40 text-[10px] tracking-[0.3em] uppercase text-center">
          your silence has been kept.
        </p>
      </section>
    )
  }

  return (
    <section className="px-6 py-5 flex flex-col gap-3">
      <h3 className="text-white/40 text-[10px] tracking-[0.3em] uppercase">if this were you.</h3>
      {p.sent ? (
        <p className="text-white/85 text-lg italic font-serif leading-relaxed">your reply has been sent.</p>
      ) : (
        <>
          <textarea value={p.reply} onChange={(e) => p.onChange(e.target.value)}
            placeholder="write back, or let it be."
            rows={4} disabled={p.submitting}
            className="w-full bg-[#111] border border-white/20 text-white/90
              text-base font-serif leading-[1.7] p-3.5 outline-none
              focus:border-white/60 transition-colors resize-none
              placeholder:text-white/30 disabled:opacity-40" />
          <div className="flex justify-end gap-2">
            <button onClick={p.onLetItBe}
              disabled={p.submitting || !!p.reply.trim()}
              title="leave the letter as it is — no reply"
              className="text-white/55 text-[10px] tracking-[0.3em] uppercase
                px-4 py-2 border border-white/20 hover:border-white/60
                hover:text-white bg-transparent transition-colors
                disabled:opacity-25 disabled:cursor-not-allowed">let it be</button>
            <button onClick={p.onSend}
              disabled={p.submitting || !p.reply.trim()}
              className="text-white/85 text-[10px] tracking-[0.3em] uppercase
                px-5 py-2 border border-white/40 hover:border-white
                bg-transparent transition-colors
                disabled:opacity-30 disabled:cursor-not-allowed">send</button>
          </div>
        </>
      )}
      {p.error && <p className="text-red-400/80 text-xs">failed: {p.error}</p>}
    </section>
  )
}
