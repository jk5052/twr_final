'use client'
import { useEffect, useRef, useState } from 'react'
import { getSupabase } from '@/lib/supabase'
import { getPlayerId, getSessionId } from '@/lib/session'

const MODEL_VERSION  = 'claude-sonnet-4-5'
const SCHEMA_VERSION = 'vocab@1.0'

interface PromptResponse {
  prompt:         string
  context_n:      number
  model_version:  string
  schema_version: string
}

export interface JournalingOverlayProps {
  fromRoom: number
  toRoom:   number | null   // null이면 마지막 방 종료
  recentEvent: string | null  // 직전 이벤트 텍스트 — prompt seed (트리거)
  seedWords: string[]         // 누적 오라클 단어 — 서버가 그 중 하나 픽
  onComplete: () => void    // submit 또는 skip 후 부모가 phase 전환
}

type Step = 'pick' | 'loading' | 'writing'

export default function JournalingOverlay({
  fromRoom, toRoom, recentEvent, seedWords, onComplete,
}: JournalingOverlayProps) {
  // 단어가 2개 미만이면 픽 단계 스킵 — 곧장 fetch.
  const canPick = seedWords.length >= 2
  const [step, setStep] = useState<Step>(canPick ? 'pick' : 'loading')
  const [picked,  setPicked]  = useState<string[]>([])
  const [prompt,   setPrompt]   = useState<string | null>(null)
  const [error,    setError]    = useState<string | null>(null)
  const [response, setResponse] = useState('')
  const [submitting, setSubmitting] = useState(false)
  const contextNRef = useRef<number>(0)
  const fetchedRef  = useRef(false)

  const fetchPrompt = async (words: string[]) => {
    if (fetchedRef.current) return
    fetchedRef.current = true
    setStep('loading')
    try {
      const r = await fetch('/api/journal-prompt', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          session_id: getSessionId(),
          from_room:  fromRoom,
          recent_event: recentEvent,
          seed_words:   words,
        }),
      })
      if (!r.ok) {
        setError((await r.text()).slice(0, 200))
        return
      }
      const j = await r.json() as PromptResponse
      setPrompt(j.prompt)
      contextNRef.current = j.context_n
      setStep('writing')
    } catch (e) {
      setError(String(e).slice(0, 200))
    }
  }

  // pick 단계 스킵 시 자동 fetch (마운트 1회).
  useEffect(() => {
    if (!canPick) fetchPrompt(seedWords)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  const togglePick = (w: string) => {
    setPicked((cur) =>
      cur.includes(w)
        ? cur.filter(x => x !== w)
        : cur.length >= 3 ? cur : [...cur, w],
    )
  }

  // 2) submit / skip → journals insert → onComplete
  const finish = async (writeResponse: string | null) => {
    if (submitting) return
    setSubmitting(true)
    try {
      if (prompt) {
        await getSupabase().from('journals').insert({
          session_id: getSessionId(),
          player_id:  getPlayerId() || null,
          from_room:  fromRoom,
          to_room:    toRoom,
          prompt,
          response:   writeResponse,
          context_n:  contextNRef.current,
          model_version:  MODEL_VERSION,
          schema_version: SCHEMA_VERSION,
        })
      }
    } catch (e) {
      console.warn('[journals] insert failed:', e)
    } finally {
      onComplete()
    }
  }

  return (
    <div className="absolute inset-0 z-40 bg-black/85 backdrop-blur-md
      flex flex-col items-center justify-center px-8">
      <div className="max-w-xl w-full flex flex-col items-center gap-8">
        <p className="text-white/30 text-[10px] tracking-[0.4em] uppercase">
          {toRoom === null ? 'before you leave' : `room ${fromRoom} → ${toRoom}`}
        </p>

        {step === 'pick' && (
          <>
            <p className="text-white/60 text-base leading-relaxed text-center max-w-md">
              Pick <span className="text-white/90">two or three</span> words that pull at you.
            </p>
            <div className="flex flex-wrap gap-2 justify-center max-w-2xl">
              {seedWords.map((w, i) => {
                const on = picked.includes(w)
                return (
                  <button
                    key={`${w}-${i}`}
                    onClick={() => togglePick(w)}
                    className={`text-xs tracking-wider px-3 py-1.5 border transition-all duration-300 ${
                      on
                        ? 'border-white/70 text-white bg-white/10'
                        : 'border-white/15 text-white/45 hover:border-white/40 hover:text-white/80'
                    }`}
                  >{w}</button>
                )
              })}
            </div>
            <div className="flex gap-6 items-center">
              <span className="text-white/30 text-[10px] tracking-[0.3em] uppercase">
                {picked.length} / 3
              </span>
              <button
                onClick={() => fetchPrompt([])}
                className="text-white/25 hover:text-white/60 text-xs
                  tracking-[0.3em] uppercase px-4 py-2 transition-colors"
              >skip</button>
              <button
                onClick={() => fetchPrompt(picked)}
                disabled={picked.length < 2}
                className="text-white/60 hover:text-white text-xs
                  tracking-[0.3em] uppercase px-4 py-2 border border-white/20
                  hover:border-white/60 transition-colors
                  disabled:opacity-30 disabled:cursor-not-allowed"
              >continue ▸</button>
            </div>
          </>
        )}

        {step === 'loading' && !error && (
          <p className="text-white/40 text-sm tracking-widest animate-pulse">thinking…</p>
        )}
        {error && (
          <p className="text-red-400/70 text-xs tracking-wider">prompt failed: {error}</p>
        )}
        {step === 'writing' && prompt && (
          <>
            {picked.length > 0 && (
              <div className="flex flex-wrap gap-2 justify-center max-w-2xl
                animate-[fadeIn_600ms_ease-out]">
                {picked.map((w, i) => (
                  <span key={`${w}-${i}`}
                    className="text-[10px] tracking-[0.3em] uppercase
                      px-3 py-1.5 border border-white/30 text-white/80
                      bg-white/5">
                    {w}
                  </span>
                ))}
              </div>
            )}
            <p className="text-white/85 text-lg leading-relaxed text-center
              animate-[fadeIn_600ms_ease-out]">
              {prompt}
            </p>
            <textarea
              value={response}
              onChange={(e) => setResponse(e.target.value)}
              placeholder="(write, or leave blank)"
              rows={4}
              className="w-full bg-transparent border border-white/15
                text-white/80 text-sm leading-relaxed p-4 outline-none
                focus:border-white/40 transition-colors duration-300
                placeholder:text-white/20"
            />
            <div className="flex gap-6">
              <button
                onClick={() => finish(null)}
                disabled={submitting}
                className="text-white/30 hover:text-white/70 text-xs
                  tracking-[0.3em] uppercase px-4 py-2 transition-colors"
              >skip</button>
              <button
                onClick={() => finish(response.trim() || null)}
                disabled={submitting}
                className="text-white/60 hover:text-white text-xs
                  tracking-[0.3em] uppercase px-4 py-2 border border-white/20
                  hover:border-white/60 transition-colors"
              >{submitting ? '…' : 'continue'}</button>
            </div>
          </>
        )}
      </div>
    </div>
  )
}
