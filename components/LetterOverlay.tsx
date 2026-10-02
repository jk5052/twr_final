'use client'
import { useEffect, useRef, useState } from 'react'
import { getSessionId, getPlayerId } from '@/lib/session'

// Letter-receive phase. Sits on top of finalroom, directly after
// LetterComposeOverlay (compose-first flow). /api/letter matches a seed
// letter using letter_exchanges.composed_letter_embedding via
// match_letter_for_session_v2; lane (primary_defense) still comes from
// blank_fill_responses (mirrored by SealingOverlay's first answer).
// The compose submit is awaited client-side so the embedding should be
// ready, but a defensive 425 retry remains in case of a slow write.
// onComplete advances to LetterReplyOverlay (the private response phase).

interface LetterOverlayProps {
  onComplete: () => void
}

interface LetterRes {
  letter_id:        string
  letter_text:      string
  primary_defense:  string | null
  author_pseudonym: string | null
  source:           string
}

export default function LetterOverlay({ onComplete }: LetterOverlayProps) {
  const [letter, setLetter]   = useState<LetterRes | null>(null)
  const [loading, setLoading] = useState(true)
  const [showContinue, setShowContinue] = useState(false)
  const [error, setError]     = useState<string | null>(null)
  const fetchedRef = useRef(false)

  useEffect(() => {
    if (fetchedRef.current) return
    fetchedRef.current = true
    void (async () => {
      // 425 = sealing's blank-fill mirror not landed yet. Retry with backoff
      // before surfacing as an error so a slow embed call doesn't strand the player.
      const delays = [400, 800, 1500, 2500, 4000]
      try {
        for (let i = 0; i <= delays.length; i++) {
          const r = await fetch('/api/letter', {
            method: 'POST',
            headers: { 'content-type': 'application/json' },
            body: JSON.stringify({ session_id: getSessionId(), player_id: getPlayerId() }),
          })
          if (r.ok) {
            const data = await r.json() as LetterRes
            setLetter(data)
            return
          }
          if (r.status === 425 && i < delays.length) {
            await new Promise((res) => setTimeout(res, delays[i]))
            continue
          }
          setError((await r.text()).slice(0, 200))
          return
        }
      } catch (e) {
        setError(String(e).slice(0, 200))
      } finally {
        setLoading(false)
      }
    })()
  }, [])

  // After letter loads, reveal continue button on a small delay so the player
  // can read what arrived before being prompted to move on.
  useEffect(() => {
    if (!letter) return
    const t = setTimeout(() => setShowContinue(true), 2200)
    return () => clearTimeout(t)
  }, [letter])

  return (
    <div className="absolute inset-0 z-30 flex flex-col items-center justify-end pb-10 px-6 pointer-events-none">
      <div className="absolute inset-x-0 bottom-0 h-2/3 pointer-events-none
        bg-gradient-to-t from-black/85 via-black/55 to-transparent" />

      <div className="pointer-events-auto w-full max-w-2xl flex-1 flex flex-col justify-end
        gap-6 py-10 mb-6 relative">

        <div className="text-white text-base leading-relaxed
          [text-shadow:0_1px_4px_rgba(0,0,0,0.85)]">
          {loading && <span className="text-white/60 text-sm tracking-widest animate-pulse">a letter is arriving…</span>}
          {!loading && letter && (
            <div className="animate-[fadeIn_1500ms_ease-out]">
              <p className="text-white/55 text-[11px] tracking-[0.3em] uppercase mb-2">
                a letter has found you.
              </p>
              <p className="text-white/40 text-[10px] tracking-[0.2em] uppercase mb-4 max-w-md">
                it is not an answer. it is a nearby trace — someone who passed through here before.
              </p>
              <p className="text-white/55 text-[10px] tracking-[0.3em] uppercase mb-4">
                {letter.author_pseudonym ? `from ${letter.author_pseudonym}` : 'from a stranger'}
              </p>
              <p className="whitespace-pre-wrap">{letter.letter_text}</p>
            </div>
          )}
          {error && <p className="mt-2 text-red-300 text-xs">failed: {error}</p>}
        </div>

        {!loading && letter && showContinue && (
          <div className="flex justify-center animate-[fadeIn_900ms_ease-out]">
            <button
              onClick={onComplete}
              className="text-white text-xs tracking-[0.3em] uppercase
                px-6 py-3 border border-white/40 hover:border-white
                bg-black/50 backdrop-blur-sm transition-colors"
            >continue ▸</button>
          </div>
        )}
      </div>
    </div>
  )
}
