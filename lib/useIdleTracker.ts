'use client'
import { useEffect, useRef } from 'react'
import { useGameStore, IDLE_THRESHOLD_MS } from '@/stores/gameStore'

/**
 * 마우스 정지 + 클릭 없음 상태가 IDLE_THRESHOLD_MS 이상 지속되면
 * idle bout으로 간주하고, 활동 재개 시 누적 시간을 store에 기록.
 *
 * @param enabled  방 진입 + 인트로 종료 시 true
 * @param room     현재 방 번호
 */
export function useIdleTracker(enabled: boolean, room: number) {
  const addIdleBout = useGameStore((s) => s.addIdleBout)
  const lastActivityRef = useRef<number>(Date.now())
  const idleStartRef = useRef<number | null>(null)

  useEffect(() => {
    if (!enabled) return

    lastActivityRef.current = Date.now()
    idleStartRef.current = null

    const onActivity = () => {
      const now = Date.now()
      // idle 상태였다면 종료 처리
      if (idleStartRef.current !== null) {
        const duration = now - idleStartRef.current
        if (duration >= IDLE_THRESHOLD_MS) {
          addIdleBout(room, duration)
        }
        idleStartRef.current = null
      }
      lastActivityRef.current = now
    }

    // 주기적 체크 — 마지막 활동 이후 threshold 초과 시 idle 시작 마킹
    const tick = window.setInterval(() => {
      const now = Date.now()
      const sinceLast = now - lastActivityRef.current
      if (sinceLast >= IDLE_THRESHOLD_MS && idleStartRef.current === null) {
        idleStartRef.current = lastActivityRef.current + IDLE_THRESHOLD_MS
      }
    }, 500)

    window.addEventListener('mousemove', onActivity)
    window.addEventListener('pointerdown', onActivity)
    window.addEventListener('keydown', onActivity)

    return () => {
      window.clearInterval(tick)
      window.removeEventListener('mousemove', onActivity)
      window.removeEventListener('pointerdown', onActivity)
      window.removeEventListener('keydown', onActivity)
      // unmount 시점에 진행 중인 idle bout 마감
      if (idleStartRef.current !== null) {
        const duration = Date.now() - idleStartRef.current
        if (duration >= IDLE_THRESHOLD_MS) {
          addIdleBout(room, duration)
        }
        idleStartRef.current = null
      }
    }
  }, [enabled, room, addIdleBout])
}
