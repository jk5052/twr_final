'use client'
import { useEffect, useRef, useState } from 'react'

export interface CollectedWordsPanelProps {
  words: string[]              // 누적된 전체 단어
  freshCount?: number          // 가장 마지막에 추가된 N개 (fade-in highlight)
}

// 우상단 항상 표시되는 누적 단어 패널.
// 새로 추가된 단어는 잠시 밝게 fade-in 한 뒤 일반 톤으로 가라앉음.
export default function CollectedWordsPanel({ words, freshCount = 0 }: CollectedWordsPanelProps) {
  const [highlightUntil, setHighlightUntil] = useState<number>(0)
  const lastLenRef = useRef<number>(words.length)

  useEffect(() => {
    if (words.length > lastLenRef.current) {
      // 새 단어 들어옴 — 1.6s 동안 highlight
      setHighlightUntil(Date.now() + 1600)
    }
    lastLenRef.current = words.length
  }, [words.length])

  const [, force] = useState(0)
  useEffect(() => {
    if (highlightUntil === 0) return
    const t = window.setTimeout(() => force((x) => x + 1), Math.max(0, highlightUntil - Date.now()))
    return () => window.clearTimeout(t)
  }, [highlightUntil])

  if (words.length === 0) return null

  const isFresh = (i: number): boolean => {
    if (Date.now() >= highlightUntil) return false
    return i >= words.length - freshCount
  }

  return (
    <div className="pointer-events-none absolute top-12 right-12 z-30
      flex flex-col items-end gap-1 max-h-[60vh] overflow-hidden">
      <span className="text-white/25 text-[9px] tracking-[0.4em] uppercase mb-2">
        collected
      </span>
      {words.map((w, i) => (
        <span
          key={i}
          className={`text-xs tracking-[0.25em] uppercase border-b pb-0.5
            transition-all duration-700 ease-out
            ${isFresh(i)
              ? 'text-white/90 border-white/40'
              : 'text-white/35 border-white/10'}`}
        >
          {w}
        </span>
      ))}
    </div>
  )
}
