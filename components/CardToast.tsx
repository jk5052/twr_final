'use client'
import { useEffect, useState } from 'react'

interface CardToastProps {
  // Monotonically increasing counter — bump it whenever a card is collected.
  // The toast re-triggers its fade animation on every change.
  trigger: number
}

// Bottom-left "+1 card" notification. Auto-clears after ~1.8s.
// pointer-events-none so it never blocks the room beneath it.
export default function CardToast({ trigger }: CardToastProps) {
  const [shownAt, setShownAt] = useState<number>(0)

  useEffect(() => {
    if (trigger <= 0) return
    setShownAt(Date.now())
    const t = window.setTimeout(() => setShownAt(0), 1800)
    return () => window.clearTimeout(t)
  }, [trigger])

  if (shownAt === 0) return null

  return (
    <div className="pointer-events-none absolute bottom-8 left-8 z-30
      text-white/85 text-xs tracking-[0.35em] uppercase
      animate-[fadeIn_300ms_ease-out]">
      card collected +1
    </div>
  )
}
