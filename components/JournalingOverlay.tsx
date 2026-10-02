'use client'
import { useEffect, useRef, useState } from 'react'
import { getSupabase } from '@/lib/supabase'
import { getPlayerId, getSessionId } from '@/lib/session'
import { cardImagePath } from '@/data/readymadeCards'

// model/schema 는 서버 응답을 그대로 반영 — 클라이언트 상수는 fallback.
const MODEL_VERSION_FALLBACK  = 'claude-sonnet-4-5'
const SCHEMA_VERSION_FALLBACK = 'journaling@1.0'

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
  seedCards: number[]         // 아직 사용하지 않은 카드 — pick 단계에서 2-3장 선택
  onComplete: (usedCards: number[]) => void  // 사용한 카드를 넘기고 부모가 phase 전환
}

type Step = 'pick' | 'loading' | 'writing'

export default function JournalingOverlay({
  fromRoom, toRoom, recentEvent, seedCards, onComplete,
}: JournalingOverlayProps) {
  // 카드가 2장 미만이면 픽 단계 스킵 — 곧장 fetch.
  const canPick = seedCards.length >= 2
  const [step, setStep] = useState<Step>(canPick ? 'pick' : 'loading')
  const [picked,  setPicked]  = useState<number[]>([])
  const [prompt,   setPrompt]   = useState<string | null>(null)
  const [error,    setError]    = useState<string | null>(null)
  const [response, setResponse] = useState('')
  const [submitting, setSubmitting] = useState(false)
  // 타로 덱 펼침 — 마운트 직후 deck(쌓인 상태) → fan(부채꼴) 로 transition.
  // stagger delay 는 카드별 transitionDelay 로 i*60ms.
  const [fanned, setFanned] = useState(false)
  const contextNRef = useRef<number>(0)
  const modelVerRef = useRef<string>(MODEL_VERSION_FALLBACK)
  const schemaVerRef = useRef<string>(SCHEMA_VERSION_FALLBACK)
  const fetchedRef  = useRef(false)
  const usedCardsRef = useRef<number[]>([])

  useEffect(() => {
    if (step !== 'pick') return
    const t = window.setTimeout(() => setFanned(true), 120)
    return () => window.clearTimeout(t)
  }, [step])

  const fetchPrompt = async (cards: number[]) => {
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
          // picked card id 들 — 라우트가 개수만 보고 LLM prompt 의 시작
          // 신호로 사용한다 (이미지가 끌어당겼다는 사실만 전달).
          seed_cards:   cards,
        }),
      })
      if (!r.ok) {
        setError((await r.text()).slice(0, 200))
        return
      }
      const j = await r.json() as PromptResponse
      // 실제 요청에 사용한 카드만 기록. pick에서 skip하거나 생성이 실패하면 소모하지 않음.
      usedCardsRef.current = [...cards]
      setPrompt(j.prompt)
      contextNRef.current = j.context_n
      modelVerRef.current  = j.model_version  || MODEL_VERSION_FALLBACK
      schemaVerRef.current = j.schema_version || SCHEMA_VERSION_FALLBACK
      setStep('writing')
    } catch (e) {
      setError(String(e).slice(0, 200))
    }
  }

  // pick 단계 스킵 시 자동 fetch (마운트 1회).
  useEffect(() => {
    if (!canPick) fetchPrompt(seedCards)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  const togglePick = (id: number) => {
    setPicked((cur) =>
      cur.includes(id)
        ? cur.filter(x => x !== id)
        : cur.length >= 3 ? cur : [...cur, id],
    )
  }

  // 2) submit / skip → journals insert → onComplete
  const finish = async (writeResponse: string | null) => {
    if (submitting) return
    setSubmitting(true)
    try {
      if (prompt) {
        const sessionId = getSessionId()
        await getSupabase(sessionId).from('journals').insert({
          session_id: sessionId,
          player_id:  getPlayerId() || null,
          from_room:  fromRoom,
          to_room:    toRoom,
          prompt,
          response:   writeResponse,
          context_n:  contextNRef.current,
          model_version:  modelVerRef.current,
          schema_version: schemaVerRef.current,
        })
      }
    } catch (e) {
      console.warn('[journals] insert failed:', e)
    } finally {
      onComplete(usedCardsRef.current)
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
            <p className="text-white/60 text-base leading-relaxed text-center max-w-md font-serif italic">
              Pick <span className="text-white/90">two or three</span> cards that pull at you.
            </p>
            {/* 타로 덱 fan. 각 카드는 absolute 로 viewport 중앙 하단을 origin
                으로 부채꼴 spread. 마운트 시 deck(0,0) → fan 으로 stagger
                transition. transform-origin: bottom center 라 회전이 카드
                밑변을 축으로 일어남 (실제 카드를 펼치는 손짓). */}
            <div className="relative w-screen max-w-[1100px] h-[420px] flex items-end justify-center -mx-8 [perspective:1200px]">
              {seedCards.map((id, i) => {
                const n = seedCards.length
                const maxAngle = Math.min(70, 14 + n * 5)
                const spread   = Math.min(n * 90, 880)
                const t        = n === 1 ? 0.5 : i / (n - 1)
                const angle    = (t - 0.5) * maxAngle * 2
                const tx       = (t - 0.5) * spread
                const ty       = Math.abs(angle) * 1.4      // 호의 곡률
                const on       = picked.includes(id)
                return (
                  <button
                    key={id}
                    type="button"
                    aria-label={`Card ${id}`}
                    aria-pressed={on}
                    onClick={() => togglePick(id)}
                    style={{
                      transform: fanned
                        ? `translate(${tx}px, ${ty}px) rotate(${angle}deg)`
                        : `translate(0px, 60px) rotate(0deg) scale(0.92)`,
                      transitionDelay: fanned ? `${i * 70}ms` : '0ms',
                      transformOrigin: 'bottom center',
                      ['--card-layer' as string]: on ? 60 : i,
                      ['--rest-transform' as string]: on ? 'translateY(-40px)' : 'translateY(0)',
                      ['--preview-transform' as string]:
                        `rotate(${-angle}deg) translateY(${-ty - 48}px) scale(1.3)`,
                    }}
                    className="group absolute bottom-4 z-[var(--card-layer)]
                      hover:z-[100] focus-visible:z-[100] focus-visible:outline-none
                      transition-transform duration-[1100ms]
                      ease-[cubic-bezier(0.22,1,0.36,1)]
                      motion-reduce:transition-none will-change-transform"
                  >
                    {/* 버튼의 hit area는 고정하고 그림만 들어 올려 hover 깜빡임을 방지.
                        fan 회전을 상쇄해 선택 전에도 카드 전체를 똑바로 볼 수 있게 한다. */}
                    <div className="relative pointer-events-none origin-bottom
                      transition-transform duration-300 ease-out motion-reduce:transition-none
                      [transform:var(--rest-transform)]
                      group-hover:[transform:var(--preview-transform)]
                      group-focus-visible:[transform:var(--preview-transform)]">
                      {/* glow halo — picked 일 때만 카드 뒤에서 발광 */}
                      <div className={`absolute inset-0 rounded-sm transition-opacity duration-700
                        ${on
                          ? 'opacity-100 bg-white/10 shadow-[0_0_40px_8px_rgba(255,255,255,0.35),0_0_80px_20px_rgba(200,180,255,0.18)]'
                          : 'opacity-0'}`} />
                      <img
                        src={cardImagePath(id)}
                        alt=""
                        draggable={false}
                        className={`relative w-44 h-64 object-contain bg-black
                          border transition-[border,filter,box-shadow] duration-300
                          group-hover:border-white/90 group-hover:brightness-110
                          group-focus-visible:border-white/90 group-focus-visible:brightness-110
                          group-hover:shadow-[0_24px_60px_rgba(0,0,0,0.8)]
                          group-focus-visible:shadow-[0_24px_60px_rgba(0,0,0,0.8)]
                          ${on
                            ? 'border-white/90 brightness-110'
                            : 'border-white/25 brightness-90'}`}
                      />
                    </div>
                  </button>
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
              // 가벼운 부채꼴(fan). pick step 의 큰 spread 와 달리 여기선 약하게 —
              // 카드는 보조 시각자료이지 메인 액션이 아니라서. absolute + relative
              // 컨테이너로 깔고, transform-origin: bottom center 라 회전축이 카드
              // 아래쪽. translateY(-|angle|*k) 으로 호의 곡률.
              <div className="relative w-full max-w-[640px] h-[340px]
                flex items-end justify-center mb-4
                animate-[fadeIn_900ms_ease-out]">
                {picked.map((id, i) => {
                  const n        = picked.length
                  const t        = n === 1 ? 0.5 : i / (n - 1)
                  const maxAngle = n === 1 ? 0 : 12          // 전체 spread ±12°
                  const angle    = (t - 0.5) * maxAngle * 2
                  const tx       = (t - 0.5) * (n * 100)     // 좌우 fan offset
                  const ty       = Math.abs(angle) * 1.2     // 호의 곡률 위쪽으로
                  const dur      = 4200 + i * 700            // 비동기 drift
                  const delay    = i * 380
                  return (
                    // Wrapper 가 fan 위치 (absolute + translateX(-50%) 로 카드의
                    // 가로 중앙 정렬). 내부 img 는 cardFloat 으로 drift — transform
                    // 충돌 (utility -translate-x-1/2 가 keyframe transform 에
                    // 덮어쓰이는 문제) 을 두 노드로 분리해서 회피.
                    <div
                      key={id}
                      style={{
                        left:   `calc(50% + ${tx}px)`,
                        bottom: `${ty}px`,
                        zIndex: i,
                      }}
                      className="absolute -translate-x-1/2"
                    >
                      <img
                        src={cardImagePath(id)}
                        alt=""
                        style={{
                          ['--tilt' as string]: `${angle}deg`,
                          transformOrigin: 'bottom center',
                          animation: `cardFloat ${dur}ms ease-in-out ${delay}ms infinite`,
                        }}
                        className="w-40 h-60 md:w-48 md:h-72 object-cover
                          border border-white/40
                          shadow-[0_14px_40px_-10px_rgba(0,0,0,0.75)]
                          will-change-transform"
                      />
                    </div>
                  )
                })}
              </div>
            )}
            <p className="text-white/85 text-lg leading-relaxed text-center
              mt-4 animate-[fadeIn_700ms_ease-out]">
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
