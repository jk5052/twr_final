'use client'
import { useEffect, useRef, useState } from 'react'
import { getSessionId, getPlayerId } from '@/lib/session'

// finalroom 위에 떠 있는 빈칸 채우기 단계.
// VoidDialogue 종료 직후, 같은 흰 Void 톤으로 이어진다.
// GET /api/blank-fill 으로 해시 기반 템플릿 1개 받음 → 한 줄 답변 → POST → onComplete.

interface BlankFillOverlayProps {
  onComplete: () => void
}

interface TemplateRes { id: number; template: string }

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

export default function BlankFillOverlay({ onComplete }: BlankFillOverlayProps) {
  const [tpl, setTpl] = useState<TemplateRes | null>(null)
  const [answer, setAnswer] = useState('')
  const [loading, setLoading] = useState(true)
  const [submitting, setSubmitting] = useState(false)
  const [done, setDone] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const fetchedRef = useRef(false)

  useEffect(() => {
    if (fetchedRef.current) return
    fetchedRef.current = true
    void (async () => {
      try {
        const r = await fetch(`/api/blank-fill?session_id=${encodeURIComponent(getSessionId())}`)
        if (!r.ok) { setError((await r.text()).slice(0, 200)); return }
        setTpl(await r.json() as TemplateRes)
      } catch (e) {
        setError(String(e).slice(0, 200))
      } finally {
        setLoading(false)
      }
    })()
  }, [])

  async function submit() {
    if (!tpl || submitting || done) return
    const ans = answer.trim()
    if (!ans) return
    setSubmitting(true)
    setError(null)
    try {
      const r = await fetch('/api/blank-fill', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          session_id:  getSessionId(),
          player_id:   getPlayerId(),
          template_id: tpl.id,
          answer:      ans,
        }),
      })
      if (!r.ok) {
        setError((await r.text()).slice(0, 200))
        return
      }
      setDone(true)
    } catch (e) {
      setError(String(e).slice(0, 200))
    } finally {
      setSubmitting(false)
    }
  }

  const onKey = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault()
      void submit()
    }
  }

  const parts = tpl ? splitTemplate(tpl.template) : []

  return (
    <div className="absolute inset-0 z-30 flex flex-col items-center justify-end pb-10 px-6 pointer-events-none">
      {/* Void scrim — VoidDialogue 와 동일 톤 */}
      <div className="absolute inset-x-0 bottom-0 h-2/3 pointer-events-none
        bg-gradient-to-t from-black/85 via-black/55 to-transparent" />

      <div className="pointer-events-auto w-full max-w-2xl flex-1 flex flex-col justify-end
        gap-8 py-10 mb-6 relative">
        {/* prompt — 템플릿을 한 줄로 그리고 ___ 를 underline 으로 강조 */}
        <div className="text-white text-xl leading-relaxed
          [text-shadow:0_1px_4px_rgba(0,0,0,0.85)]
          animate-[fadeIn_500ms_ease-out]">
          {loading && <span className="text-white/60 text-sm tracking-widest animate-pulse">…</span>}
          {!loading && tpl && (
            <p>
              {parts.map((p, i) =>
                p === '___'
                  ? <span key={i} className="inline-block min-w-[6ch] mx-1 border-b border-white/70 align-baseline">&nbsp;</span>
                  : <span key={i}>{p}</span>,
              )}
            </p>
          )}
          {error && <p className="mt-2 text-red-300 text-xs">failed: {error}</p>}
        </div>

        {/* 입력 / 완료 버튼 */}
        {done ? (
          <div className="flex justify-center">
            <button
              onClick={onComplete}
              className="text-white text-xs tracking-[0.3em] uppercase
                px-6 py-3 border border-white/40 hover:border-white
                bg-black/50 backdrop-blur-sm transition-colors"
            >continue ▸</button>
          </div>
        ) : (
          <div className="flex items-end gap-3">
            <textarea
              value={answer}
              onChange={(e) => setAnswer(e.target.value)}
              onKeyDown={onKey}
              placeholder="fill the blank. (Enter to submit, Shift+Enter for newline)"
              rows={2}
              disabled={loading || submitting || !tpl}
              className="flex-1 bg-black/60 backdrop-blur-sm border border-white/30
                text-white text-sm leading-relaxed p-3 outline-none
                focus:border-white/70 transition-colors resize-none
                placeholder:text-white/40 disabled:opacity-40"
            />
            <button
              onClick={() => void submit()}
              disabled={submitting || loading || !answer.trim()}
              className="text-white text-xs tracking-[0.3em] uppercase
                px-4 py-3 border border-white/40 hover:border-white
                bg-black/50 backdrop-blur-sm transition-colors
                disabled:opacity-30 disabled:cursor-not-allowed"
            >submit</button>
          </div>
        )}
      </div>
    </div>
  )
}
