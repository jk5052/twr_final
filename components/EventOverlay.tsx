'use client'
import { useEffect, useRef, useState } from 'react'
import type { Choice, ObjectEvent, Tag } from '@/data/events'
import { HOVER_DWELL_MIN_MS } from '@/stores/gameStore'

const POST_NARRATION_MS = 1600

export interface ChoiceMeta {
  latency_ms: number
  changed_mind: boolean
  hover_sequence: Tag[]
}

interface EventOverlayProps {
  event: ObjectEvent
  onChoose: (choice: Choice, meta: ChoiceMeta, choiceIndex: number) => void   // chain 진행은 부모가 처리
  onCancel: () => void
}

export default function EventOverlay({ event, onChoose, onCancel }: EventOverlayProps) {
  const openedAtRef = useRef<number>(Date.now())
  const hoverSequenceRef = useRef<Tag[]>([])
  const hoverStartRef = useRef<{ tag: Tag; t: number } | null>(null)
  const [narration, setNarration] = useState<string | null>(null)

  // event 바뀔 때(=chain 다음 단계) 타이머/hover 초기화
  useEffect(() => {
    openedAtRef.current = Date.now()
    hoverSequenceRef.current = []
    hoverStartRef.current = null
    setNarration(null)
  }, [event])

  // ESC 취소 — narration 단계에선 비활성 (이미 선택은 끝남)
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape' && !narration) onCancel()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [onCancel, narration])

  const startHover = (tag: Tag) => {
    hoverStartRef.current = { tag, t: Date.now() }
  }

  const endHover = () => {
    const start = hoverStartRef.current
    if (!start) return
    const dwell = Date.now() - start.t
    if (dwell >= HOVER_DWELL_MIN_MS) {
      hoverSequenceRef.current.push(start.tag)
    }
    hoverStartRef.current = null
  }

  const handleClick = (choice: Choice, choiceIndex: number) => {
    endHover()
    const sequence = hoverSequenceRef.current
    const meta: ChoiceMeta = {
      latency_ms: Date.now() - openedAtRef.current,
      hover_sequence: sequence,
      changed_mind: sequence.length > 0 && sequence[sequence.length - 1] !== choice.tag,
    }
    if (choice.postNarration) {
      // narration 잠깐 표시 → onChoose 호출 (그 다음은 부모가 chain 진행)
      setNarration(choice.postNarration)
      window.setTimeout(() => onChoose(choice, meta, choiceIndex), POST_NARRATION_MS)
    } else {
      onChoose(choice, meta, choiceIndex)
    }
  }

  return (
    <div
      className="absolute inset-0 z-10 bg-black/60 backdrop-blur-sm
        transition-all duration-700 flex flex-col items-center justify-end pb-16"
      onClick={(e) => {
        if (!narration && e.target === e.currentTarget) onCancel()
      }}
    >
      {narration ? (
        <p className="text-white/80 text-lg mb-10 max-w-md text-center leading-relaxed
          animate-[fadeIn_400ms_ease-out]">
          {narration}
        </p>
      ) : (
        <>
          <p className="text-white/80 text-lg mb-10 max-w-md text-center leading-relaxed">
            {event.text}
          </p>
          <div className="flex flex-col gap-3 items-center">
            {event.choices.map((choice, i) => (
              <button
                key={i}
                onClick={(e) => {
                  e.stopPropagation()
                  handleClick(choice, i)
                }}
                onPointerEnter={() => startHover(choice.tag)}
                onPointerLeave={endHover}
                className="text-white/40 hover:text-white text-sm
                  transition-colors duration-500 px-6 py-2"
              >
                {choice.label}
              </button>
            ))}
          </div>
          <p className="absolute bottom-4 right-6 text-white/20 text-[10px] tracking-widest">
            ESC to step back
          </p>
        </>
      )}
    </div>
  )
}
