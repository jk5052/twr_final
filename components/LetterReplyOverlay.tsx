'use client'
import { useEffect, useRef, useState } from 'react'
import { getSessionId, getPlayerId } from '@/lib/session'

// Letter-reply phase. Sits between LetterOverlay (receive) and
// CardOverlay (compose-first flow — the player wrote their own letter
// before receiving). The player has just read a stranger's letter
// matched against their composed letter; this overlay lets them write
// a small, private reply directed at that letter.
//
// Side effects:
//   POST /api/letter      → re-fetches the pinned letter for context
//                          (idempotent on the server; same row returns).
//   POST /api/respond-to-letter → saves reply_text + reply_at onto
//                          letter_exchanges. reply_text NEVER enters
//                          seed_letters; this is a private response,
//                          not an archive contribution.
// onComplete advances to CardOverlay.

interface LetterReplyOverlayProps {
  onComplete: () => void
}

interface LetterRes {
  letter_id:        string
  letter_text:      string
  primary_defense:  string | null
  author_pseudonym: string | null
  source:           string
}

export default function LetterReplyOverlay({ onComplete }: LetterReplyOverlayProps) {
  const [letter, setLetter]   = useState<LetterRes | null>(null)
  const [reply, setReply]     = useState('')
  const [busy, setBusy]       = useState(false)
  const [error, setError]     = useState<string | null>(null)
  const fetchedRef = useRef(false)

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
        setLetter(await r.json() as LetterRes)
      } catch (e) {
        setError(String(e).slice(0, 200))
      }
    })()
  }, [])

  async function save() {
    if (busy || !reply.trim()) return
    setBusy(true); setError(null)
    try {
      const r = await fetch('/api/respond-to-letter', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          session_id: getSessionId(),
          player_id:  getPlayerId(),
          reply_text: reply.trim(),
        }),
      })
      if (!r.ok) { setError((await r.text()).slice(0, 200)); return }
      onComplete()
    } catch (e) {
      setError(String(e).slice(0, 200))
    } finally { setBusy(false) }
  }

  return (
    <div className="absolute inset-0 z-30 flex flex-col items-center justify-end pb-10 px-6 pointer-events-none">
      <div className="absolute inset-x-0 bottom-0 h-2/3 pointer-events-none
        bg-gradient-to-t from-black/85 via-black/55 to-transparent" />

      <div className="pointer-events-auto w-full max-w-2xl flex-1 flex flex-col justify-end
        gap-5 py-10 mb-6 relative">

        {!letter && !error && (
          <p className="text-white/60 text-sm tracking-widest animate-pulse text-center">
            holding the letter…
          </p>
        )}

        {letter && (
          <div className="animate-[fadeIn_900ms_ease-out] flex flex-col gap-5">
            <div className="text-white/55 text-xs leading-relaxed max-h-40 overflow-y-auto
              border-l border-white/20 pl-4 [text-shadow:0_1px_4px_rgba(0,0,0,0.85)]">
              <p className="text-white/40 text-[10px] tracking-[0.3em] uppercase mb-2">
                {letter.author_pseudonym ? `from ${letter.author_pseudonym}` : 'from a stranger'}
              </p>
              <p className="whitespace-pre-wrap italic">{letter.letter_text}</p>
            </div>

            <p className="text-white/60 text-[11px] tracking-[0.3em] uppercase text-center">
              write a small reply.
            </p>
            <p className="text-white/40 text-[10px] leading-relaxed text-center max-w-md mx-auto">
              not for the archive — only between you and them.
              <br/>a sentence is enough.
            </p>
            <textarea
              value={reply}
              onChange={(e) => setReply(e.target.value)}
              rows={4}
              disabled={busy}
              placeholder="reply here."
              className="bg-black/60 backdrop-blur-sm border border-white/30
                text-white text-sm leading-relaxed p-3 outline-none
                focus:border-white/70 transition-colors resize-none
                placeholder:text-white/40 disabled:opacity-40"
            />
            <div className="flex justify-center">
              <button
                onClick={() => void save()}
                disabled={busy || !reply.trim()}
                className="text-white text-xs tracking-[0.3em] uppercase
                  px-6 py-3 border border-white/40 hover:border-white
                  bg-black/50 backdrop-blur-sm transition-colors
                  disabled:opacity-30 disabled:cursor-not-allowed"
              >send ▸</button>
            </div>
          </div>
        )}

        {error && <p className="text-red-300 text-xs text-center">failed: {error}</p>}
      </div>
    </div>
  )
}
