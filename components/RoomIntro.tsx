'use client'
import { useEffect } from 'react'

interface RoomIntroProps {
  text: string
  onComplete: () => void
}

const DURATION_MS = 5000

export default function RoomIntro({ text, onComplete }: RoomIntroProps) {
  useEffect(() => {
    const timer = window.setTimeout(onComplete, DURATION_MS)
    return () => window.clearTimeout(timer)
  }, [onComplete])

  return (
    <div className="fixed inset-0 z-50 pointer-events-auto">
      {/* 위 눈꺼풀 */}
      <div
        className="absolute inset-x-0 top-0 h-1/2 bg-black"
        style={{ animation: `blinkIntroTop ${DURATION_MS}ms ease-in-out forwards` }}
      />
      {/* 아래 눈꺼풀 */}
      <div
        className="absolute inset-x-0 bottom-0 h-1/2 bg-black"
        style={{ animation: `blinkIntroBottom ${DURATION_MS}ms ease-in-out forwards` }}
      />
      {/* 떠오르는 생각 */}
      <div className="absolute inset-0 flex items-center justify-center pointer-events-none">
        <p
          className="text-white/70 text-2xl tracking-[0.15em] font-light"
          style={{ animation: `blinkIntroText ${DURATION_MS}ms ease-in-out forwards` }}
        >
          {text}
        </p>
      </div>
    </div>
  )
}
