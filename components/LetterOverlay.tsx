'use client'
import { useEffect, useRef, useState } from 'react'
import { getSessionId, getPlayerId } from '@/lib/session'

// Letter exchange phase. Sits on top of finalroom, after BlankFillOverlay.
// Fetches one matched letter (POST /api/letter), fades it in, then offers
// a reply textarea OR a "let it be" path (silent ack, sentinel '·').
// Saving a real reply → share Yes/No prompt. Let-it-be → straight to onComplete.

const LET_IT_BE = '\u00b7'

interface LetterOverlayProps {
  onComplete: () => void
}

interface LetterRes {
  letter_id:        string
  letter_text:      string
  primary_defense:  string | null
  author_pseudonym: string | null
  source:           string
  reply_text:       string | null
  already_replied:  boolean
}

export default function LetterOverlay({ onComplete }: LetterOverlayProps) {
  const [letter, setLetter] = useState<LetterRes | null>(null)
  const [reply, setReply]   = useState('')
  const [loading, setLoading]       = useState(true)
  const [submitting, setSubmitting] = useState(false)
  const [done, setDone]             = useState(false)
  const [letItBe, setLetItBe]       = useState(false)
  const [showReplyUI, setShowReplyUI] = useState(false)
  const [sharing, setSharing]         = useState(false)
  const [error, setError]           = useState<string | null>(null)
  const fetchedRef = useRef(false)

  async function decideShare(share: boolean) {
    if (sharing) return
    setSharing(true)
    setError(null)
    try {
      const r = await fetch('/api/share-letter', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          session_id: getSessionId(),
          player_id:  getPlayerId(),
          share,
        }),
      })
      if (!r.ok) { setError((await r.text()).slice(0, 200)); setSharing(false); return }
      onComplete()
    } catch (e) {
      setError(String(e).slice(0, 200))
      setSharing(false)
    }
  }

  useEffect(() => {
    if (fetchedRef.current) return
    fetchedRef.current = true
    void (async () => {
      try {
        const r = await fetch('/api/letter', {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ session_id: getSessionId(), player_id: getPlayerId() }),
        })
        if (!r.ok) { setError((await r.text()).slice(0, 200)); return }
        const data = await r.json() as LetterRes
        setLetter(data)
        if (data.already_replied) {
          const prior = data.reply_text ?? ''
          if (prior === LET_IT_BE) { setLetItBe(true); setReply('') }
          else { setReply(prior) }
          setDone(true)
        }
      } catch (e) {
        setError(String(e).slice(0, 200))
      } finally {
        setLoading(false)
      }
    })()
  }, [])

  // After letter loads, reveal reply UI on a small delay to let it breathe.
  useEffect(() => {
    if (!letter || done) return
    const t = setTimeout(() => setShowReplyUI(true), 1800)
    return () => clearTimeout(t)
  }, [letter, done])

  async function submit() {
    if (!letter || submitting || done) return
    const txt = reply.trim()
    if (!txt) return
    setSubmitting(true)
    setError(null)
    try {
      const r = await fetch('/api/letter', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          session_id: getSessionId(),
          player_id:  getPlayerId(),
          reply_text: txt,
        }),
      })
      if (!r.ok) { setError((await r.text()).slice(0, 200)); return }
      setDone(true)
    } catch (e) {
      setError(String(e).slice(0, 200))
    } finally {
      setSubmitting(false)
    }
  }

  // Silent acknowledgement path. Saves sentinel '·' as reply_text, skips the
  // share Yes/No (auto-no, never enters the pool), continues to card phase.
  async function letItBeSubmit() {
    if (!letter || submitting || done) return
    setSubmitting(true)
    setError(null)
    try {
      const r = await fetch('/api/letter', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          session_id: getSessionId(),
          player_id:  getPlayerId(),
          let_it_be:  true,
        }),
      })
      if (!r.ok) { setError((await r.text()).slice(0, 200)); return }
      setLetItBe(true)
      setDone(true)
    } catch (e) {
      setError(String(e).slice(0, 200))
    } finally {
      setSubmitting(false)
    }
  }

  const onKey = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) {
      e.preventDefault()
      void submit()
    }
  }

  return (
    <div className="absolute inset-0 z-30 flex flex-col items-center justify-end pb-10 px-6 pointer-events-none">
      {/* Void scrim — same tone as BlankFillOverlay / VoidDialogue */}
      <div className="absolute inset-x-0 bottom-0 h-2/3 pointer-events-none
        bg-gradient-to-t from-black/85 via-black/55 to-transparent" />

      <div className="pointer-events-auto w-full max-w-2xl flex-1 flex flex-col justify-end
        gap-6 py-10 mb-6 relative">

        {/* arrived letter */}
        <div className="text-white text-base leading-relaxed
          [text-shadow:0_1px_4px_rgba(0,0,0,0.85)]">
          {loading && <span className="text-white/60 text-sm tracking-widest animate-pulse">a letter is arriving…</span>}
          {!loading && letter && (
            <div className="animate-[fadeIn_1500ms_ease-out]">
              <p className="text-white/50 text-[10px] tracking-[0.3em] uppercase mb-3">
                {letter.author_pseudonym ? `from ${letter.author_pseudonym}` : 'from a stranger'}
              </p>
              <p className="whitespace-pre-wrap">{letter.letter_text}</p>
            </div>
          )}
          {error && <p className="mt-2 text-red-300 text-xs">failed: {error}</p>}
        </div>

        {/* reply UI */}
        {!loading && letter && (done ? (letItBe ? (
          // let-it-be path: silent ack, no share prompt, straight continue
          <div className="flex flex-col items-center gap-5 animate-[fadeIn_700ms_ease-out]">
            <p className="text-white/70 text-2xl font-serif italic select-none">·</p>
            <p className="text-white/40 text-[10px] leading-relaxed text-center max-w-sm">
              your silence has been kept.
            </p>
            <button
              onClick={onComplete}
              className="text-white text-xs tracking-[0.3em] uppercase
                px-6 py-3 border border-white/40 hover:border-white
                bg-black/50 backdrop-blur-sm transition-colors"
            >continue ▸</button>
          </div>
        ) : (
          <div className="flex flex-col gap-5 animate-[fadeIn_700ms_ease-out]">
            {reply && (
              <p className="text-white/70 text-sm leading-relaxed italic
                [text-shadow:0_1px_4px_rgba(0,0,0,0.85)] whitespace-pre-wrap">
                — your reply: {reply}
              </p>
            )}
            <p className="text-white/60 text-[11px] tracking-[0.3em] uppercase text-center">
              share this back into the room?
            </p>
            <p className="text-white/40 text-[10px] leading-relaxed text-center max-w-md mx-auto">
              your words may reach the next stranger who arrives here.
              you stay anonymous.
            </p>
            <div className="flex justify-center gap-3">
              <button
                onClick={() => void decideShare(true)}
                disabled={sharing}
                className="text-white text-xs tracking-[0.3em] uppercase
                  px-6 py-3 border border-white/40 hover:border-white
                  bg-black/50 backdrop-blur-sm transition-colors
                  disabled:opacity-30 disabled:cursor-not-allowed"
              >yes, share</button>
              <button
                onClick={() => void decideShare(false)}
                disabled={sharing}
                className="text-white/70 text-xs tracking-[0.3em] uppercase
                  px-6 py-3 border border-white/20 hover:border-white/60
                  bg-black/50 backdrop-blur-sm transition-colors
                  disabled:opacity-30 disabled:cursor-not-allowed"
              >no, keep private</button>
            </div>
            {error && <p className="text-red-300/80 text-xs text-center">failed: {error}</p>}
          </div>
        )) : showReplyUI && (
          <div className="flex flex-col gap-3 animate-[fadeIn_900ms_ease-out]">
            {/* reframe — defuses blank-page panic, threads back to player's own answer */}
            <p className="text-white/55 text-[10px] tracking-[0.3em] uppercase
              [text-shadow:0_1px_4px_rgba(0,0,0,0.85)]">
              if this were you.
            </p>
            <div className="flex items-end gap-3">
              <textarea
                value={reply}
                onChange={(e) => setReply(e.target.value)}
                onKeyDown={onKey}
                placeholder="write back, or let it be. (Cmd/Ctrl+Enter to send)"
                rows={3}
                disabled={submitting}
                className="flex-1 bg-black/60 backdrop-blur-sm border border-white/30
                  text-white text-sm leading-relaxed p-3 outline-none
                  focus:border-white/70 transition-colors resize-none
                  placeholder:text-white/40 disabled:opacity-40"
              />
              <div className="flex flex-col gap-2">
                <button
                  onClick={() => void submit()}
                  disabled={submitting || !reply.trim()}
                  className="text-white text-xs tracking-[0.3em] uppercase
                    px-4 py-3 border border-white/40 hover:border-white
                    bg-black/50 backdrop-blur-sm transition-colors
                    disabled:opacity-30 disabled:cursor-not-allowed"
                >send</button>
                <button
                  onClick={() => void letItBeSubmit()}
                  disabled={submitting || !!reply.trim()}
                  title="leave the letter as it is — no reply, no sharing"
                  className="text-white/60 text-[10px] tracking-[0.3em] uppercase
                    px-4 py-2 border border-white/20 hover:border-white/60
                    hover:text-white/90 bg-black/40 backdrop-blur-sm transition-colors
                    disabled:opacity-20 disabled:cursor-not-allowed"
                >let it be</button>
              </div>
            </div>
          </div>
        ))}
      </div>
    </div>
  )
}
