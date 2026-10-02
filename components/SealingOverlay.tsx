'use client'
import { useEffect, useRef, useState } from 'react'
import { getSessionId, getPlayerId } from '@/lib/session'

// Sealing ritual phase. Sits between ConversationScene and LetterComposeOverlay
// (compose-first flow). Three fill-in prompts deterministically picked from
// blank_fill_templates (via /api/sealing-prompts), one at a time. Each
// submission posts to /api/final-reflections by template_id. Per-prompt
// skip ("let it be") leaves no row. First non-skipped answer is also
// mirrored to /api/blank-fill (fire-and-forget) to populate
// blank_fill_responses.primary_defense — the lane signal used by the
// v2 letter match RPC. After all three, onComplete advances to letter-compose.

interface SealingOverlayProps {
  onComplete: () => void
}

interface SealingPrompt {
  template_id: number
  template:    string                 // contains exactly one '___'
}

const INTRO_TEXT = 'before you leave, three lines for the room.'

// "I left ___ behind." → ['I left ', '___', ' behind.']
function splitTemplate(tpl: string): string[] {
  const parts = tpl.split('___')
  if (parts.length < 2) return [tpl]
  const out: string[] = []
  parts.forEach((p, i) => {
    out.push(p)
    if (i < parts.length - 1) out.push('___')
  })
  return out
}

export default function SealingOverlay({ onComplete }: SealingOverlayProps) {
  const [prompts, setPrompts]       = useState<SealingPrompt[]>([])
  const [step, setStep]             = useState(0)
  const [answer, setAnswer]         = useState('')
  const [loading, setLoading]       = useState(true)
  const [submitting, setSubmitting] = useState(false)
  const [error, setError]           = useState<string | null>(null)
  const fetchedRef = useRef(false)
  // sealing 이 기존 blank_fill phase 를 흡수하면서, downstream find-poems/letter/
  // card-bundle 이 의존하는 blank_fill_responses (answer_embedding + primary_defense)
  // 도 채워야 함. 첫 번째 비-skip 답변을 /api/blank-fill 에 fire-and-forget POST.
  const bfPostedRef = useRef(false)

  useEffect(() => {
    if (fetchedRef.current) return
    fetchedRef.current = true
    void (async () => {
      try {
        const r = await fetch(`/api/sealing-prompts?session_id=${encodeURIComponent(getSessionId())}`)
        if (!r.ok) { setError((await r.text()).slice(0, 200)); return }
        const j = await r.json() as { prompts?: SealingPrompt[] }
        setPrompts(Array.isArray(j.prompts) ? j.prompts : [])
      } catch (e) {
        setError(String(e).slice(0, 200))
      } finally {
        setLoading(false)
      }
    })()
  }, [])

  const current = prompts[step] ?? null
  const done    = !loading && prompts.length > 0 && step >= prompts.length

  async function submit(skip: boolean) {
    if (!current || submitting) return
    const ans = answer.trim()
    if (!skip && !ans) return            // require non-empty unless explicitly skipping
    setSubmitting(true)
    setError(null)
    try {
      if (!skip) {
        const r = await fetch('/api/final-reflections', {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({
            session_id:  getSessionId(),
            player_id:   getPlayerId(),
            template_id: current.template_id,
            answer_text: ans,
          }),
        })
        if (!r.ok) { setError((await r.text()).slice(0, 200)); return }
        // 첫 번째 실제 답변 1개만 blank_fill_responses 에도 mirror. 실패해도
        // sealing flow 자체는 진행 — embedding 누락 시 downstream 이 409 로 안내.
        if (!bfPostedRef.current) {
          bfPostedRef.current = true
          void fetch('/api/blank-fill', {
            method: 'POST',
            headers: { 'content-type': 'application/json' },
            body: JSON.stringify({
              session_id:  getSessionId(),
              player_id:   getPlayerId(),
              template_id: current.template_id,
              answer:      ans,
            }),
          }).catch(() => { /* swallow */ })
        }
      }
      setStep((s) => s + 1)
      setAnswer('')
    } catch (e) {
      setError(String(e).slice(0, 200))
    } finally {
      setSubmitting(false)
    }
  }

  const onKey = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault()
      void submit(false)
    }
  }

  return (
    <div className="absolute inset-0 z-30 flex flex-col items-center justify-end pb-10 px-6 pointer-events-none">
      {/* Void scrim — same tone as BlankFillOverlay / LetterOverlay */}
      <div className="absolute inset-x-0 bottom-0 h-2/3 pointer-events-none
        bg-gradient-to-t from-black/85 via-black/55 to-transparent" />

      <div className="pointer-events-auto w-full max-w-2xl flex-1 flex flex-col justify-end
        gap-7 py-10 mb-6 relative">

        {/* ritual frame — quiet intro line */}
        <p className="text-white/55 text-[10px] tracking-[0.3em] uppercase
          [text-shadow:0_1px_4px_rgba(0,0,0,0.85)]">
          {INTRO_TEXT}
        </p>

        {/* loading — quiet placeholder while picks resolve */}
        {loading && (
          <div className="text-white/60 text-sm tracking-widest animate-pulse
            [text-shadow:0_1px_4px_rgba(0,0,0,0.85)]">…</div>
        )}

        {/* fetch failed — let the player advance rather than block on it */}
        {!loading && prompts.length === 0 && (
          <div className="flex flex-col items-center gap-4 animate-[fadeIn_700ms_ease-out]">
            <p className="text-white/50 text-xs leading-relaxed text-center max-w-sm
              [text-shadow:0_1px_4px_rgba(0,0,0,0.85)]">
              {error ? `failed to load: ${error}` : 'no prompts available.'}
            </p>
            <button
              onClick={onComplete}
              className="text-white text-xs tracking-[0.3em] uppercase
                px-6 py-3 border border-white/40 hover:border-white
                bg-black/50 backdrop-blur-sm transition-colors"
            >continue ▸</button>
          </div>
        )}

        {/* prompt — re-key forces fade-in on each step */}
        {current && (() => {
          const parts = splitTemplate(current.template)
          return (
            <div key={current.template_id} className="text-white text-xl leading-relaxed
              [text-shadow:0_1px_4px_rgba(0,0,0,0.85)]
              animate-[fadeIn_700ms_ease-out]">
              <p>
                {parts.map((p, i) =>
                  p === '___'
                    ? <span key={i} className="inline-block min-w-[6ch] mx-1 border-b border-white/70 align-baseline">&nbsp;</span>
                    : <span key={i}>{p}</span>,
                )}
              </p>
              <p className="mt-2 text-white/40 text-[10px] tracking-[0.2em] uppercase">
                {step + 1} of {prompts.length}
              </p>
              {error && <p className="mt-2 text-red-300 text-xs">failed: {error}</p>}
            </div>
          )
        })()}

        {/* input row */}
        {current && !done && (
          <div className="flex items-end gap-3 animate-[fadeIn_900ms_ease-out]">
            <textarea
              value={answer}
              onChange={(e) => setAnswer(e.target.value)}
              onKeyDown={onKey}
              placeholder="fill the blank. (Enter to send, Shift+Enter for newline)"
              rows={2}
              disabled={submitting}
              className="flex-1 bg-black/60 backdrop-blur-sm border border-white/30
                text-white text-sm leading-relaxed p-3 outline-none
                focus:border-white/70 transition-colors resize-none
                placeholder:text-white/40 disabled:opacity-40"
            />
            <div className="flex flex-col gap-2">
              <button
                onClick={() => void submit(false)}
                disabled={submitting || !answer.trim()}
                className="text-white text-xs tracking-[0.3em] uppercase
                  px-4 py-3 border border-white/40 hover:border-white
                  bg-black/50 backdrop-blur-sm transition-colors
                  disabled:opacity-30 disabled:cursor-not-allowed"
              >send</button>
              <button
                onClick={() => void submit(true)}
                disabled={submitting || !!answer.trim()}
                title="leave this line blank"
                className="text-white/60 text-[10px] tracking-[0.3em] uppercase
                  px-4 py-2 border border-white/20 hover:border-white/60
                  hover:text-white/90 bg-black/40 backdrop-blur-sm transition-colors
                  disabled:opacity-20 disabled:cursor-not-allowed"
              >let it be</button>
            </div>
          </div>
        )}

        {/* completion — quiet continue */}
        {done && (
          <div className="flex flex-col items-center gap-5 animate-[fadeIn_700ms_ease-out]">
            <p className="text-white/40 text-[10px] leading-relaxed text-center max-w-sm">
              the room is sealed.
            </p>
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
