'use client'
import Spline from '@splinetool/react-spline'
import { useEffect, useState } from 'react'
import { useGameStore } from '@/stores/gameStore'
import {
  ITEM_BY_NAME,
  ROOM_MODELS,
  ROOM_INTROS,
  ROOM_ENTRY_EVENTS,
  ENTRY_ITEM_ID,
  FINAL_MODEL,
  type ObjectEvent,
} from '@/data/events'
import { useIdleTracker } from '@/lib/useIdleTracker'
import { preloadChoicesIndex } from '@/lib/choicesIndex'
import { logChoice } from '@/lib/narrativeLog'
import { pickOracleWords } from '@/data/oracleWords'
import { resetSessionId } from '@/lib/session'
import Room from '@/components/Room'
import EventOverlay from '@/components/EventOverlay'
import RoomIntro from '@/components/RoomIntro'
import CollectedWordsPanel from '@/components/CollectedWordsPanel'
import JournalingOverlay from '@/components/JournalingOverlay'
import VoidDialogue from '@/components/VoidDialogue'
import BlankFillOverlay from '@/components/BlankFillOverlay'
import LetterOverlay from '@/components/LetterOverlay'
import CardOverlay from '@/components/CardOverlay'

const ROOM_PHASES = ['room1', 'room2', 'room3', 'room4', 'room5'] as const
type RoomPhase = (typeof ROOM_PHASES)[number]
const isRoomPhase = (p: string): p is RoomPhase => (ROOM_PHASES as readonly string[]).includes(p)

export default function Home() {
  const phase = useGameStore((s) => s.phase)
  const setPhase = useGameStore((s) => s.setPhase)
  const addChoice = useGameStore((s) => s.addChoice)
  const choices = useGameStore((s) => s.choices)
  const startRoom = useGameStore((s) => s.startRoom)
  const addCancellation = useGameStore((s) => s.addCancellation)
  const collectedWords = useGameStore((s) => s.collectedWords)
  const addOracleWords = useGameStore((s) => s.addOracleWords)
  const resetForNewPlay = useGameStore((s) => s.resetForNewPlay)

  // chain runner — item chain과 entry chain 모두 처리.
  // entry chain은 itemId = ENTRY_ITEM_ID로 식별.
  const [chain, setChain] = useState<
    { itemId: string; events: ObjectEvent[]; index: number } | null
  >(null)
  const [introsShown, setIntrosShown] = useState<Set<number>>(new Set())
  const currentEvent = chain ? chain.events[chain.index] ?? null : null

  // 방 transition 시 띄우는 저널링 모달 (door click 또는 next-room 버튼).
  const [journaling, setJournaling] = useState<{ from: number; to: number | null } | null>(null)

  // 방 컨텍스트 (훅을 조건부로 못 쓰니 top-level에서 계산)
  const inRoom = isRoomPhase(phase)
  const roomNumber = inRoom ? parseInt(phase.replace('room', ''), 10) : 0
  // 모든 방에 RoomIntro(눈 깜빡임) 흐름. 텍스트 없으면 빈 문자열로 fallback.
  const introText = inRoom ? ROOM_INTROS[roomNumber] ?? '' : ''
  const showIntro = inRoom && !introsShown.has(roomNumber)

  // 방 진입 시 RoomLog 초기화
  useEffect(() => {
    if (inRoom) startRoom(roomNumber)
  }, [inRoom, roomNumber, startRoom])

  // choices_rag 라벨 한 번 preload — narrative_logs upsert 시 스냅샷용.
  useEffect(() => {
    preloadChoicesIndex()
  }, [])

  // RoomIntro 종료 콜백 — intro 마킹 + entry chain 자동 시작 (방당 1회).
  const handleIntroComplete = (room: number) => {
    setIntrosShown((prev) => new Set(prev).add(room))
    const events = ROOM_ENTRY_EVENTS[room]
    if (events && events.length > 0) {
      setChain({ itemId: ENTRY_ITEM_ID, events, index: 0 })
    }
  }

  // idle 트래킹 — 인트로/오버레이 중에는 비활성
  useIdleTracker(inRoom && !showIntro && !chain, roomNumber)

  // Landing
  if (phase === 'landing') {
    return (
      <div className="relative w-screen h-screen bg-black overflow-hidden">
        <Spline scene="https://prod.spline.design/N17xaJGIJPeIZR3T/scene.splinecode" />
        {/* Spline 워터마크 가리기 */}
        <div className="absolute bottom-0 right-0 w-40 h-12 bg-black z-50" />
        <div className="absolute right-16 top-1/2 -translate-y-1/2 pointer-events-none">
          <button
            onClick={() => {
              // 새 플레이 시작 — session_id 새로 발급 + 인-메모리 게임 상태 리셋.
              // 동일 탭에서 replay 시 기존 letter_exchanges/card 가 묶여 새 매칭/생성이
              // 안 되던 문제를 해소.
              resetSessionId()
              resetForNewPlay()
              setPhase('intro')
            }}
            className="pointer-events-auto text-white/40 hover:text-white
              text-sm tracking-[0.3em] uppercase transition-all duration-1000
              border border-white/10 hover:border-white/30 px-8 py-3"
          >
            Play
          </button>
        </div>
      </div>
    )
  }

  // Intro — introvideo.mp4 재생 후 자동으로 room1. 클릭 시 스킵.
  if (phase === 'intro') {
    return (
      <div
        onClick={() => setPhase('room1')}
        className="w-screen h-screen bg-black flex items-center justify-center cursor-pointer"
      >
        <video
          src="/introvideo.mp4"
          autoPlay
          muted
          playsInline
          onEnded={() => setPhase('room1')}
          className="w-full h-full object-cover"
        />
        <p className="absolute bottom-6 right-6 text-white/30 text-[10px] tracking-[0.3em] uppercase pointer-events-none">
          click to skip
        </p>
      </div>
    )
  }

  // Rooms 1~5 (r3f + GLB)
  if (inRoom) {
    const modelPath = ROOM_MODELS[roomNumber]
    const roomChoiceCount = choices.filter((c) => c.room === roomNumber).length
    // 방 넘어가기 버튼은 좌측상단에 항상 표시 (chain/intro 중일 때만 숨김).
    const showNextBtn = !chain && !showIntro
    const nextPhase: RoomPhase | 'conversation' =
      roomNumber < 5 ? (`room${roomNumber + 1}` as RoomPhase) : 'conversation'

    return (
      <div className="relative w-screen h-screen bg-black">
        <Room
          modelPath={modelPath}
          onObjectClick={(name) => {
            if (chain || showIntro || journaling) return
            const item = ITEM_BY_NAME[name]
            if (!item) return
            // door 클릭 → 저널링 모달 (chain 시작 안 함)
            if (item.kind === 'door') {
              setJournaling({ from: roomNumber, to: nextPhase === 'conversation' ? null : Number(nextPhase.replace('room','')) })
              return
            }
            if (item.events.length === 0) return
            // TODO: cctv/oneTimeOnly 분기는 후속 작업
            setChain({ itemId: name, events: item.events, index: 0 })
          }}
          isInteractive={(name) =>
            !!ITEM_BY_NAME[name] && !chain && !showIntro
          }
        />

        {showIntro && (
          <RoomIntro
            text={introText}
            onComplete={() => handleIntroComplete(roomNumber)}
          />
        )}

        {chain && currentEvent && (
          <EventOverlay
            // event 변경 시 EventOverlay 내부 상태 리셋되도록 key 부여
            key={`${chain.itemId}#${chain.index}`}
            event={currentEvent}
            onChoose={(choice, meta, choiceIndex) => {
              const isLast = chain.index >= chain.events.length - 1
              const ended = !!choice.endChain || isLast
              addChoice({
                room: roomNumber,
                itemId: chain.itemId,
                eventIndex: chain.index,
                event_text: currentEvent.text,
                response: choice.label,
                tag: choice.tag,
                defenses: choice.defenses,
                ended_chain: ended,
                latency_ms: meta.latency_ms,
                changed_mind: meta.changed_mind,
                hover_sequence: meta.hover_sequence,
              })
              // Supabase narrative_logs (fire-and-forget; 실패해도 게임은 진행).
              void logChoice({
                room: roomNumber,
                itemId: chain.itemId,
                eventIndex: chain.index,
                choiceIndex,
                prompt: currentEvent.text,
                label: choice.label,
                tag: choice.tag,
                endChain: ended,
                latencyMs: meta.latency_ms,
                changedMind: meta.changed_mind,
                hoverSequence: meta.hover_sequence,
              })
              // choice마다 오라클 단어 3개 누적 — 우상단 패널에 append
              addOracleWords(pickOracleWords(3))
              if (ended) setChain(null)
              else setChain({ ...chain, index: chain.index + 1 })
            }}
            onCancel={() => {
              addCancellation(roomNumber)
              setChain(null)
            }}
          />
        )}

        <CollectedWordsPanel words={collectedWords} freshCount={3} />

        {journaling && (
          <JournalingOverlay
            fromRoom={journaling.from}
            toRoom={journaling.to}
            recentEvent={currentEvent?.text ?? choices[choices.length - 1]?.event_text ?? null}
            seedWords={collectedWords}
            onComplete={() => {
              setJournaling(null)
              setPhase(nextPhase)
            }}
          />
        )}

        {showNextBtn && (
          <button
            onClick={() => setJournaling({
              from: roomNumber,
              to: nextPhase === 'conversation' ? null : Number(nextPhase.replace('room','')),
            })}
            className="absolute top-4 left-4 text-white/30 hover:text-white/80
              text-[10px] tracking-[0.3em] uppercase transition-colors duration-700
              px-2 py-1"
          >
            {roomNumber < 5 ? 'next room ▸' : 'continue ▸'}
          </button>
        )}

        <div className="absolute bottom-4 left-4 text-white/20 text-xs tracking-widest">
          Room {roomNumber} / 5 · {roomChoiceCount} chosen
        </div>
      </div>
    )
  }

  // Void — finalroom 배경 위에서 LLM 대화 (영어, 무명 voice)
  if (phase === 'conversation') {
    return (
      <div className="relative w-screen h-screen bg-black">
        <Room
          modelPath={FINAL_MODEL}
          onObjectClick={() => {}}
          isInteractive={() => false}
          disableControls
        />
        <VoidDialogue onComplete={() => setPhase('blank_fill')} />
      </div>
    )
  }

  // Blank fill — 같은 finalroom 배경 위에서 한 줄 빈칸 채우기
  if (phase === 'blank_fill') {
    return (
      <div className="relative w-screen h-screen bg-black">
        <Room
          modelPath={FINAL_MODEL}
          onObjectClick={() => {}}
          isInteractive={() => false}
          disableControls
        />
        <BlankFillOverlay onComplete={() => setPhase('letter')} />
      </div>
    )
  }

  // Letter exchange — 같은 finalroom 배경 위에서 도착한 편지 + 답장
  if (phase === 'letter') {
    return (
      <div className="relative w-screen h-screen bg-black">
        <Room
          modelPath={FINAL_MODEL}
          onObjectClick={() => {}}
          isInteractive={() => false}
          disableControls
        />
        <LetterOverlay onComplete={() => setPhase('card')} />
      </div>
    )
  }

  // Talisman card — 마지막 출력. PDF 미리보기 + 다운로드.
  if (phase === 'card') {
    return (
      <div className="relative w-screen h-screen bg-black">
        <Room
          modelPath={FINAL_MODEL}
          onObjectClick={() => {}}
          isInteractive={() => false}
          disableControls
        />
        <CardOverlay onComplete={() => setPhase('landing')} />
      </div>
    )
  }

  return null
}