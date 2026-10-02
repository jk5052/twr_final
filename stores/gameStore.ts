import { create } from 'zustand'
import type { Tag, DefenseCandidate } from '@/data/events'

// 행동 로그 임계값 — 데이터 보고 조정
export const IDLE_THRESHOLD_MS = 3000
export const HOVER_DWELL_MIN_MS = 200

interface Choice {
  room: number
  itemId: string              // GLB mesh name
  eventIndex: number          // chain 내 몇 번째 event였는지 (0-based)
  event_text: string          // 이 선택을 내릴 때 본 prompt — RAG1 Method C 컨텍스트
  response: string            // 선택지 label
  tag: Tag
  defenses: DefenseCandidate[]
  ended_chain: boolean        // 이 선택이 chain을 조기 종료시켰나
  timestamp: number
  latency_ms: number          // overlay 등장 → 클릭까지
  changed_mind: boolean       // 다른 선택지 hover 후 다른 거 클릭
  hover_sequence: Tag[]       // 클릭 전 hover 한 태그 순서 (>=HOVER_DWELL_MIN_MS)
}

interface RoomLog {
  enteredAt: number
  cancellations: number       // overlay 열었다 클릭 없이 닫음
  idle_total_ms: number       // 누적 idle (마우스 정지 + 클릭 없음)
}

interface GameState {
  phase: 'landing' | 'intro' | 'room1' | 'room2' | 'room3' | 'room4' | 'room5' | 'sealing' | 'conversation' | 'letter' | 'letter-reply' | 'letter-compose' | 'card'
  choices: Choice[]
  tags: Record<Tag, number>
  roomLogs: Record<number, RoomLog>
  collectedWords: string[]    // legacy 오라클 단어 — 더 이상 채워지지 않음 (CardToast 로 대체)
  collectedCards: number[]    // 누적 readymade card id — choice마다 1개 append
  usedCards: number[]         // 저널에 사용한 카드 — 다음 방의 pick 목록에서 제외

  setPhase: (phase: GameState['phase']) => void
  addChoice: (choice: Omit<Choice, 'timestamp'>) => void
  addOracleWords: (words: string[]) => void
  addCard: (id: number) => void
  markCardsUsed: (ids: number[]) => void
  startRoom: (room: number) => void
  addCancellation: (room: number) => void
  addIdleBout: (room: number, duration_ms: number) => void
  resetForNewPlay: () => void  // landing → intro 전환 시 호출. session 도 같이 리셋해야 letter/card 가 새로 매치됨.
}

const emptyRoomLog = (): RoomLog => ({
  enteredAt: Date.now(),
  cancellations: 0,
  idle_total_ms: 0,
})

export const useGameStore = create<GameState>((set) => ({
  phase: 'landing',
  choices: [],
  tags: { AV: 0, EX: 0, CG: 0, SP: 0, AD: 0 },
  roomLogs: {},
  collectedWords: [],
  collectedCards: [],
  usedCards: [],

  setPhase: (phase) => set({ phase }),

  addChoice: (choice) => set((state) => ({
    choices: [...state.choices, { ...choice, timestamp: Date.now() }],
    tags: {
      ...state.tags,
      [choice.tag]: state.tags[choice.tag] + 1,
    },
  })),

  addOracleWords: (words) => set((state) => ({
    collectedWords: [...state.collectedWords, ...words],
  })),

  addCard: (id) => set((state) =>
    state.collectedCards.includes(id)
      ? state                                    // 중복 보호 — pickReadymadeCard 가 이미 차단하지만 방어적으로
      : { collectedCards: [...state.collectedCards, id] }
  ),

  // 수집 이력은 유지해 사용한 카드가 새 카드로 다시 뽑히지 않게 한다.
  markCardsUsed: (ids) => set((state) => ({
    usedCards: [...new Set([...state.usedCards, ...ids])],
  })),

  startRoom: (room) => set((state) =>
    state.roomLogs[room]
      ? state                                    // 이미 시작된 방은 덮어쓰지 않음
      : { roomLogs: { ...state.roomLogs, [room]: emptyRoomLog() } }
  ),

  addCancellation: (room) => set((state) => {
    const log = state.roomLogs[room] ?? emptyRoomLog()
    return {
      roomLogs: {
        ...state.roomLogs,
        [room]: { ...log, cancellations: log.cancellations + 1 },
      },
    }
  }),

  addIdleBout: (room, duration_ms) => set((state) => {
    const log = state.roomLogs[room] ?? emptyRoomLog()
    return {
      roomLogs: {
        ...state.roomLogs,
        [room]: { ...log, idle_total_ms: log.idle_total_ms + duration_ms },
      },
    }
  }),

  resetForNewPlay: () => set({
    choices: [],
    tags: { AV: 0, EX: 0, CG: 0, SP: 0, AD: 0 },
    roomLogs: {},
    collectedWords: [],
    collectedCards: [],
    usedCards: [],
  }),
}))
