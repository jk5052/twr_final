'use client'
import { useEffect, useRef, useState } from 'react'
import { getSessionId, getPlayerId } from '@/lib/session'

// Letter-compose phase. Sits between SealingOverlay and LetterOverlay
// (compose-first flow). The player writes their own letter first; its
// embedding then becomes the matching key for /api/letter (v2 RPC).
//
// Flow (spec):
//   1. Show the player's three sealing answers back to them.
//   2. Player picks one phrase that opened a memory.
//   3. Show a writing prompt that quotes the picked phrase.
//   4. Player writes a short text — this becomes their letter.
//   5. Player decides whether the letter enters the anonymous archive.
//   6. onComplete → letter (receive matched on this composed letter).
//
// Side effects:
//   step 'select' — no API call. The pick is held locally and only sent
//     to the server when the player saves their composed letter.
//     final_reflections and blank_fill_responses are NOT mutated by
//     picking a sealing phrase here.
//   step 'write'  — POST /api/compose-letter once with
//     { selected_template_id, selected_answer, composed_letter }.
//     The endpoint embeds the composed letter (3072d halfvec) and
//     upserts letter_exchanges (creates the row in compose-first flow).
//   step 'share'  — POST /api/share-letter with { share }. share=false
//     records the choice without inserting into seed_letters.
//     share=true triggers share_player_letter RPC which copies the
//     composed letter into the future matching pool.

interface SealingAnswer {
  template_id: number
  answer_text: string
  blank_fill_templates: { template: string } | { template: string }[] | null
}

interface LetterComposeOverlayProps {
  // skip=true → 보낼 답변이 없어 letter-compose 자체가 성립 안 됨.
  // 부모는 letter receive 도 건너뛰고 다음 단계로 가야 한다 (compose 없이
  // /api/letter 를 부르면 425 composed letter embedding not ready).
  onComplete: (opts?: { skip?: boolean }) => void
}

type Step = 'load' | 'select' | 'write' | 'share' | 'done'

// "I _____ at 3 a.m." + answer "stare at the ceiling" → readable preview.
function fillTemplate(template: string, answer: string): string {
  return template.replace(/_+/g, answer.trim() || '___')
}

function tplOf(row: SealingAnswer): string {
  const t = row.blank_fill_templates
  if (!t) return ''
  if (Array.isArray(t)) return t[0]?.template ?? ''
  return t.template ?? ''
}

export default function LetterComposeOverlay({ onComplete }: LetterComposeOverlayProps) {
  const [step, setStep]         = useState<Step>('load')
  const [answers, setAnswers]   = useState<SealingAnswer[]>([])
  const [picked, setPicked]     = useState<SealingAnswer | null>(null)
  const [letter, setLetter]     = useState('')
  const [busy, setBusy]         = useState(false)
  const [error, setError]       = useState<string | null>(null)
  const fetchedRef = useRef(false)

  useEffect(() => {
    if (fetchedRef.current) return
    fetchedRef.current = true
    void (async () => {
      try {
        const sid = getSessionId()
        const r = await fetch(`/api/final-reflections?session_id=${encodeURIComponent(sid)}`)
        if (!r.ok) { setError((await r.text()).slice(0, 200)); return }
        const data = await r.json() as { answers: SealingAnswer[] }
        const rows = (data.answers ?? []).filter((a) => a.answer_text?.trim())
        if (rows.length === 0) {
          // sealing 을 skip-all 한 케이스 — 선택지가 없으므로 compose 자체가
          // 성립 안 됨. skip 신호로 부모가 letter receive 도 건너뛰게 한다.
          onComplete({ skip: true }); return
        }
        setAnswers(rows)
        setStep('select')
      } catch (e) {
        setError(String(e).slice(0, 200))
      }
    })()
  }, [onComplete])

  function pickAnswer(row: SealingAnswer) {
    if (busy) return
    setPicked(row)
    setStep('write')
  }

  async function saveLetter() {
    if (busy || !letter.trim() || !picked) return
    setBusy(true); setError(null)
    try {
      const r = await fetch('/api/compose-letter', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          session_id:           getSessionId(),
          player_id:            getPlayerId(),
          selected_template_id: picked.template_id,
          selected_answer:      picked.answer_text,
          composed_letter:      letter.trim(),
        }),
      })
      if (!r.ok) { setError((await r.text()).slice(0, 200)); return }
      setStep('share')
    } catch (e) {
      setError(String(e).slice(0, 200))
    } finally { setBusy(false) }
  }

  async function decideShare(share: boolean) {
    if (busy) return
    setBusy(true); setError(null)
    try {
      const r = await fetch('/api/share-letter', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ session_id: getSessionId(), player_id: getPlayerId(), share }),
      })
      if (!r.ok) { setError((await r.text()).slice(0, 200)); return }
      setStep('done')
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
        gap-6 py-10 mb-6 relative">

        {step === 'load' && (
          <p className="text-white/60 text-sm tracking-widest animate-pulse text-center">
            gathering what you said…
          </p>
        )}

        {step === 'select' && (
          <div className="flex flex-col gap-5 animate-[fadeIn_900ms_ease-out]">
            <p className="text-white/55 text-[11px] tracking-[0.3em] uppercase text-center">
              you sealed the room with three phrases.
            </p>
            <p className="text-white/45 text-[10px] tracking-[0.2em] uppercase text-center">
              did the letter open a memory? choose the phrase closest to it.
            </p>
            <div className="flex flex-col gap-3 mt-2">
              {answers.map((row) => (
                <button
                  key={row.template_id}
                  onClick={() => void pickAnswer(row)}
                  disabled={busy}
                  className="text-left text-white/80 text-base leading-relaxed font-serif italic
                    px-5 py-4 border border-white/20 hover:border-white/70 hover:text-white
                    bg-black/50 backdrop-blur-sm transition-colors
                    [text-shadow:0_1px_4px_rgba(0,0,0,0.85)]
                    disabled:opacity-40 disabled:cursor-not-allowed"
                >
                  {fillTemplate(tplOf(row), row.answer_text)}
                </button>
              ))}
            </div>
            {error && <p className="text-red-300 text-xs">failed: {error}</p>}
          </div>
        )}

        {step === 'write' && picked && (
          <div className="flex flex-col gap-6 animate-[fadeIn_900ms_ease-out]">
            {/* 선택한 sealing phrase — select step 의 버튼과 같은 결의 박스로
                위쪽에 띄워 카드처럼 보이게. 라벨/제목 + 한 호흡 띄운 prompt 가
                아래로 따라옴. */}
            <div className="self-center w-full max-w-xl flex flex-col gap-3">
              <p className="text-white/40 text-[10px] tracking-[0.3em] uppercase text-center">
                you chose
              </p>
              <div className="text-white/90 text-xl md:text-2xl leading-relaxed font-serif italic
                text-center px-7 py-6 border border-white/30
                bg-black/55 backdrop-blur-sm
                [text-shadow:0_1px_6px_rgba(0,0,0,0.9)]">
                {fillTemplate(tplOf(picked), picked.answer_text)}
              </div>
            </div>

            <div className="flex flex-col gap-2 mt-2">
              <p className="text-white/55 text-[11px] tracking-[0.3em] uppercase text-center">
                write the memory this phrase holds.
              </p>
              <p className="text-white/40 text-[10px] leading-relaxed text-center max-w-md mx-auto">
                a moment, a place, a person. a few lines is enough.
                <br/>this becomes your letter — for a future stranger.
              </p>
            </div>

            <textarea
              value={letter}
              onChange={(e) => setLetter(e.target.value)}
              rows={6}
              disabled={busy}
              placeholder="write here."
              className="bg-black/60 backdrop-blur-sm border border-white/30
                text-white text-sm leading-relaxed p-3 outline-none
                focus:border-white/70 transition-colors resize-none
                placeholder:text-white/40 disabled:opacity-40"
            />
            <div className="flex justify-center">
              <button
                onClick={() => void saveLetter()}
                disabled={busy || !letter.trim()}
                className="text-white text-xs tracking-[0.3em] uppercase
                  px-6 py-3 border border-white/40 hover:border-white
                  bg-black/50 backdrop-blur-sm transition-colors
                  disabled:opacity-30 disabled:cursor-not-allowed"
              >save ▸</button>
            </div>
            {error && <p className="text-red-300 text-xs text-center">failed: {error}</p>}
          </div>
        )}

        {step === 'share' && (
          <div className="flex flex-col gap-5 animate-[fadeIn_700ms_ease-out]">
            <p className="text-white/60 text-[11px] tracking-[0.3em] uppercase text-center">
              place this letter in the archive?
            </p>
            <p className="text-white/40 text-[10px] leading-relaxed text-center max-w-md mx-auto">
              if you allow it, your words may reach the next stranger who arrives here.
              <br/>you stay anonymous.
            </p>
            <div className="flex justify-center gap-3">
              <button
                onClick={() => void decideShare(true)}
                disabled={busy}
                className="text-white text-xs tracking-[0.3em] uppercase
                  px-6 py-3 border border-white/40 hover:border-white
                  bg-black/50 backdrop-blur-sm transition-colors
                  disabled:opacity-30 disabled:cursor-not-allowed"
              >yes, share</button>
              <button
                onClick={() => void decideShare(false)}
                disabled={busy}
                className="text-white/70 text-xs tracking-[0.3em] uppercase
                  px-6 py-3 border border-white/20 hover:border-white/60
                  bg-black/50 backdrop-blur-sm transition-colors
                  disabled:opacity-30 disabled:cursor-not-allowed"
              >keep private</button>
            </div>
            {error && <p className="text-red-300 text-xs text-center">failed: {error}</p>}
          </div>
        )}
      </div>
    </div>
  )
}
