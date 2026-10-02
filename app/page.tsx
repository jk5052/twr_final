'use client'
import Spline from '@splinetool/react-spline'
import { useEffect, useRef, useState } from 'react'
import { useGameStore } from '@/stores/gameStore'
import {
  ITEMS,
  ITEM_BY_NAME,
  ROOM_MODELS,
  ROOM_INTROS,
  ROOM_ENTRY_EVENTS,
  ENTRY_ITEM_ID,
  FINAL_SCENE_VIDEO,
  type ObjectEvent,
} from '@/data/events'
import { useIdleTracker } from '@/lib/useIdleTracker'
import { preloadChoicesIndex } from '@/lib/choicesIndex'
import { logChoice } from '@/lib/narrativeLog'
import { pickReadymadeCard } from '@/data/readymadeCards'
import { resetSessionId } from '@/lib/session'
import Room from '@/components/Room'
import EventOverlay from '@/components/EventOverlay'
import RoomIntro from '@/components/RoomIntro'
import CardToast from '@/components/CardToast'
import JournalingOverlay from '@/components/JournalingOverlay'
import VoidDialogue from '@/components/VoidDialogue'
import LetterOverlay from '@/components/LetterOverlay'
import LetterReplyOverlay from '@/components/LetterReplyOverlay'
import LetterComposeOverlay from '@/components/LetterComposeOverlay'
import SealingOverlay from '@/components/SealingOverlay'
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
  const collectedCards = useGameStore((s) => s.collectedCards)
  const usedCards = useGameStore((s) => s.usedCards)
  const markCardsUsed = useGameStore((s) => s.markCardsUsed)
  const addCard = useGameStore((s) => s.addCard)
  const resetForNewPlay = useGameStore((s) => s.resetForNewPlay)

  // CardToast 트리거 — 카드 한 장 픽업할 때마다 +1 해서 좌측 하단 알림 재생.
  const [cardToastBump, setCardToastBump] = useState(0)

  // chain runner — item chain과 entry chain 모두 처리.
  // entry chain은 itemId = ENTRY_ITEM_ID로 식별.
  const [chain, setChain] = useState<
    { itemId: string; events: ObjectEvent[]; index: number } | null
  >(null)
  const [introsShown, setIntrosShown] = useState<Set<number>>(new Set())
  const currentEvent = chain ? chain.events[chain.index] ?? null : null

  // 방 transition 시 띄우는 저널링 모달 (door click 또는 next-room 버튼).
  const [journaling, setJournaling] = useState<{ from: number; to: number | null } | null>(null)
  // 미탐색 아이템이 남은 채 방을 나가려 할 때 한 번 더 물어보는 confirm 모달.
  // door 클릭 또는 좌상단 next-room 버튼 클릭 시 unexplored>0 이면 발화. ok 누르면
  // setJournaling 으로 정상 전환, cancel 누르면 모달만 닫고 방에 남음.
  const [confirmExit, setConfirmExit] = useState<{ from: number; to: number | null } | null>(null)
  // zoomOnClick 플래그를 가진 아이템 (현재 R4 포스터들) 클릭 시, 카메라가 해당 mesh
  // 로 줌인. chain 종료/취소 시 base 로 복귀. Room 의 useFrame 이 lerp 처리.
  const [zoomTarget, setZoomTarget] = useState<string | null>(null)

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

  // 전시 키오스크용 auto-reset — 30분 무입력 시 hard reload 해서 다음 관람객을
  // 위해 landing 으로 복귀. landing 상태에서는 이미 휴면이라 reload 의미 없음 +
  // 빈 부스 무한 reload loop 방지 차원에서 카운트다운을 계속 리셋. 10s poll
  // 로 충분 (30분 단위 정밀도에 비해 오버헤드 무시).
  useEffect(() => {
    const IDLE_RESET_MS = 30 * 60 * 1000
    let lastActivity = Date.now()
    const bump = () => { lastActivity = Date.now() }
    const events: Array<keyof WindowEventMap> = [
      'mousemove', 'pointerdown', 'keydown', 'touchstart', 'wheel',
    ]
    events.forEach((e) => window.addEventListener(e, bump, { passive: true }))
    const tick = window.setInterval(() => {
      if (useGameStore.getState().phase === 'landing') {
        lastActivity = Date.now()
        return
      }
      if (Date.now() - lastActivity >= IDLE_RESET_MS) {
        window.location.reload()
      }
    }, 10_000)
    return () => {
      window.clearInterval(tick)
      events.forEach((e) => window.removeEventListener(e, bump))
    }
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
    // R5 종료 후엔 LLM 대화 → sealing → letter → card 순서. 다음 phase 는 conversation.
    const nextPhase: RoomPhase | 'conversation' =
      roomNumber < 5 ? (`room${roomNumber + 1}` as RoomPhase) : 'conversation'
    // 한 번 진행한 아이템은 재클릭 lockout. door 는 choices 에 기록되지 않으므로 자연히 제외.
    const isUsed = (name: string) =>
      choices.some((c) => c.room === roomNumber && c.itemId === name)
    // 현재 방에 남은 미탐색 (regular) 아이템 수. door 와 entry chain 은 제외.
    // door 클릭 / next-room 버튼 시 이 값이 >0 이면 confirm 모달 한 번 띄움.
    const unexploredCount = ITEMS
      .filter((it) => it.room === roomNumber && it.kind !== 'door')
      .filter((it) => !isUsed(it.itemId)).length
    const toRoomFor = (np: RoomPhase | 'conversation') =>
      np === 'conversation' ? null : Number(np.replace('room', ''))
    // door 또는 next-room 버튼 공통 진입점. unexplored>0 이면 confirm, 아니면 바로 journaling.
    const requestExit = () => {
      const target = { from: roomNumber, to: toRoomFor(nextPhase) }
      if (unexploredCount > 0) setConfirmExit(target)
      else setJournaling(target)
    }

    return (
      <div className="relative w-screen h-screen bg-black">
        <Room
          modelPath={modelPath}
          onObjectClick={(name) => {
            if (chain || showIntro || journaling || confirmExit) return
            const item = ITEM_BY_NAME[name]
            if (!item) return
            // door 클릭 → unexplored>0 면 confirm, 아니면 곧장 저널링 모달.
            // R5 출구는 conversation 으로 이어지므로 toRoom=null (마지막 방 종료 의미).
            if (item.kind === 'door') {
              requestExit()
              return
            }
            if (item.events.length === 0) return
            if (isUsed(name)) return
            // zoomOnClick 아이템 (R4 포스터) — chain 시작과 동시에 카메라 줌인 트리거.
            if (item.zoomOnClick) setZoomTarget(name)
            setChain({ itemId: name, events: item.events, index: 0 })
          }}
          isInteractive={(name) =>
            !!ITEM_BY_NAME[name] && !chain && !showIntro && !journaling && !isUsed(name)
          }
          // glow registry 빌드용 — noGlow 아이템 (R4 엘리베이터) 은 인터랙션은 유지하되
          // 시각적 강조에서만 제외. 포스터만 자체발광하게 됨.
          isItem={(name) => !!ITEM_BY_NAME[name] && !ITEM_BY_NAME[name].noGlow}
          isUsed={isUsed}
          zoomTarget={zoomTarget}
          disableControls
        />

        {showIntro && (
          <RoomIntro
            text={introText}
            onComplete={() => handleIntroComplete(roomNumber)}
          />
        )}

        {/* R4 포스터 chain 동안 띄우는 배경 이미지. GLB 안의 포스터 텍스처가
            저해상도라 카메라가 줌인 해도 디테일이 잘 안 보여서, public/assets/
            의 고해상도 PNG 를 같은 itemId 로 매핑 (poster_art → poster_art.png).
            EventOverlay 보다 뒤 z-stack, pointer-events-none 으로 클릭 통과. */}
        {chain && roomNumber === 4 && chain.itemId.startsWith('poster_') && (
          <div className="absolute inset-0 pointer-events-none flex items-center justify-center">
            <img
              src={`/assets/${chain.itemId}.png`}
              alt=""
              className="max-w-[55vw] max-h-[75vh] object-contain opacity-40 mix-blend-screen animate-[fadeIn_1200ms_ease-out]"
            />
          </div>
        )}

        {/* R4 포스터 chain 중 "다른 포스터 보러 가기" 버튼. 방 진입 시 5개를
            한 번에 식별하기 어려워서, 한 포스터를 줌인 한 뒤에도 다시 방 뷰로
            돌아갈 수 있어야 함. EventOverlay (z-10) 위로 z-20. 이미 choice 를
            한 번이라도 한 포스터는 isUsed 로 자연히 lockout. */}
        {chain && roomNumber === 4 && chain.itemId.startsWith('poster_') && (
          <button
            onClick={() => {
              addCancellation(roomNumber)
              setChain(null)
              setZoomTarget(null)
            }}
            className="absolute top-4 left-4 z-20 text-white/40 hover:text-white/90
              text-[10px] tracking-[0.3em] uppercase border border-white/15
              hover:border-white/40 px-3 py-2 transition-colors duration-500"
          >
            ◂ choose another
          </button>
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
              // choice마다 readymade card 한 장 픽업 — 좌측 하단 toast 로 알림.
              // 풀은 43장. 중복 픽업은 pickReadymadeCard 가 차단하고, 풀이 다 비면
              // null 을 반환해 더 이상 알림이 안 뜬다.
              const nextCard = pickReadymadeCard(useGameStore.getState().collectedCards)
              if (nextCard != null) {
                addCard(nextCard)
                setCardToastBump((b) => b + 1)
              }
              if (ended) {
                setChain(null)
                setZoomTarget(null)
                // R4 는 exit door mesh 가 없고 5 포스터/엘리베이터 chain 이 그 자체로
                // 출구 — 포스터/엘리베이터 chain 종료 시에만 자동으로 JournalingOverlay
                // 진입. entry chain (ENTRY_ITEM_ID) 끝남에는 발화 X.
                if (
                  roomNumber === 4 &&
                  (chain.itemId.startsWith('poster_') || chain.itemId === 'modern_apartment_elevator')
                ) {
                  setJournaling({ from: 4, to: 5 })
                }
              } else setChain({ ...chain, index: chain.index + 1 })
            }}
            onCancel={() => {
              // R4 엘리베이터만 단방향 동선 유지 — 들어간다 = 떠난다 의미라
              // ESC / 배경 클릭으로 빠져나갈 수 없게 함. 포스터는 미리보기 후
              // 다른 포스터를 보고 싶을 수 있어 cancel 허용. 이미 한 choice 라도
              // 한 포스터는 isUsed lockout 으로 재진입 차단.
              if (roomNumber === 4 && chain.itemId === 'modern_apartment_elevator') return
              addCancellation(roomNumber)
              setChain(null)
              setZoomTarget(null)
            }}
          />
        )}

        <CardToast trigger={cardToastBump} />

        {journaling && (
          <JournalingOverlay
            fromRoom={journaling.from}
            toRoom={journaling.to}
            recentEvent={currentEvent?.text ?? choices[choices.length - 1]?.event_text ?? null}
            seedCards={collectedCards.filter((id) => !usedCards.includes(id))}
            onComplete={(cards) => {
              markCardsUsed(cards)
              setJournaling(null)
              setPhase(nextPhase)
            }}
          />
        )}

        {showNextBtn && (
          <button
            onClick={requestExit}
            className="absolute top-4 left-4 text-white/30 hover:text-white/80
              text-[10px] tracking-[0.3em] uppercase transition-colors duration-700
              px-2 py-1"
          >
            {roomNumber < 5 ? 'next room ▸' : 'continue ▸'}
          </button>
        )}

        {confirmExit && (
          <div className="fixed inset-0 z-50 bg-black/70 backdrop-blur-sm flex items-center justify-center">
            <div className="max-w-md mx-6 px-8 py-7 border border-white/15 bg-black/80 text-center">
              <p className="font-serif text-white/85 text-lg leading-relaxed italic">
                there are still things you haven&apos;t looked at.
              </p>
              <p className="mt-2 text-white/40 text-[11px] tracking-[0.25em] uppercase">
                {unexploredCount} item{unexploredCount === 1 ? '' : 's'} left in this room
              </p>
              <div className="mt-6 flex justify-center gap-6">
                <button
                  onClick={() => setConfirmExit(null)}
                  className="text-white/60 hover:text-white/90 text-[11px] tracking-[0.3em] uppercase px-3 py-2 transition-colors duration-500"
                >
                  stay
                </button>
                <button
                  onClick={() => { const t = confirmExit; setConfirmExit(null); setJournaling(t) }}
                  className="text-white/85 hover:text-white text-[11px] tracking-[0.3em] uppercase px-3 py-2 border border-white/30 hover:border-white/60 transition-colors duration-500"
                >
                  leave anyway ▸
                </button>
              </div>
            </div>
          </div>
        )}

        <div className="absolute bottom-4 left-4 text-white/20 text-xs tracking-widest">
          Room {roomNumber} / 5 · {roomChoiceCount} chosen
        </div>
      </div>
    )
  }

  // Void — finalroom 배경 위에서 LLM 대화 (영어, 무명 voice).
  // conversation 진입 시 /subvideo.mp4 가 1회 재생되며 NPC 등장을 establish
  // 한 뒤 onEnded 에서 pause — 마지막 프레임이 그대로 멈춰 있고 그 위로
  // VoidDialogue 가 fade-in. flow: R5 → conversation(LLM) → sealing(3 lines)
  // → letter-compose → letter (receive) → letter-reply → card. compose-first
  // 라 본인 편지 임베딩으로 매칭됨 (v2 RPC). 구 blank_fill phase 는 sealing 에
  // 흡수 — SealingOverlay 가 첫 답변을 /api/blank-fill 로 mirror 하여 lane
  // (primary_defense) 파이프라인을 유지.
  if (phase === 'conversation') {
    return <ConversationScene onComplete={() => setPhase('sealing')} />
  }

  // Sealing ritual — finalroom 배경 위에서 LLM 대화 직후 3개 짧은 문장.
  // VoidDialogue 종료 직후 진입. final_reflections 에 prompt_key 별 upsert + 첫 답변은
  // blank_fill_responses 로 mirror 되어 lane(primary_defense) 파이프라인을 유지.
  // 완료 시 letter-compose 로 — 본인 편지를 먼저 쓰고 그 임베딩으로 매칭한다.
  if (phase === 'sealing') {
    return (
      <FinalSceneShell>
        <SealingOverlay onComplete={() => setPhase('letter-compose')} />
      </FinalSceneShell>
    )
  }

  // Letter compose — 3 sealing 답 중 하나를 픽 → memory prompt → 짧은 글 작성
  // → archive 공개 여부 결정. share=true 면 seed_letters 에 자기 편지가 입수됨.
  // 완료 시 letter (receive) 로 — composed_letter_embedding 으로 v2 매칭.
  // skip=true (sealing 전부 skip 한 경우) 면 letter/letter-reply 도 건너뛰고
  // 곧장 card 로 — compose 없이 /api/letter 부르면 425 가 떨어진다.
  if (phase === 'letter-compose') {
    return (
      <FinalSceneShell>
        <LetterComposeOverlay onComplete={(opts) => setPhase(opts?.skip ? 'card' : 'letter')} />
      </FinalSceneShell>
    )
  }

  // Letter receive — finalroom 배경 위에서 매칭된 편지 1개를 fade-in 으로 보여준다.
  // /api/letter 가 letter_exchanges.composed_letter_embedding + lane 으로 v2 매칭.
  // 완료 시 letter-reply 로 — 받은 편지에 짧은 사적 답장을 쓴다.
  if (phase === 'letter') {
    return (
      <FinalSceneShell>
        <LetterOverlay onComplete={() => setPhase('letter-reply')} />
      </FinalSceneShell>
    )
  }

  // Letter reply — 받은 편지를 컨텍스트로 보여주고 짧은 답장 입력.
  // /api/respond-to-letter 로 reply_text 만 저장. seed_letters 로 가지 않음.
  // 완료 시 card 로.
  if (phase === 'letter-reply') {
    return (
      <FinalSceneShell>
        <LetterReplyOverlay onComplete={() => setPhase('card')} />
      </FinalSceneShell>
    )
  }

  // Talisman card — 마지막 출력. PDF 미리보기 + 다운로드.
  if (phase === 'card') {
    return (
      <FinalSceneShell>
        <CardOverlay onComplete={() => setPhase('landing')} />
      </FinalSceneShell>
    )
  }

  return null
}

// finalroom 5 phase 공통 셸 — 미리 export 한 MP4 loop 를 배경으로. 동적 3D
// (Spline runtime / GLB) 대신 video 를 쓰는 이유는 고정된 NPC 와 같은 자리에
// 머무는 감각이 필요하기 때문. autoPlay+muted+loop+playsInline 으로 iOS 포함
// 자동 재생. object-cover 로 종횡비 보정.
function FinalSceneShell({ children }: { children: React.ReactNode }) {
  return (
    <div className="relative w-screen h-screen bg-black overflow-hidden">
      <video
        src={FINAL_SCENE_VIDEO}
        autoPlay
        muted
        loop
        playsInline
        className="absolute inset-0 w-full h-full object-cover"
      />
      {children}
    </div>
  )
}

// Conversation 진입용 인트로 영상 (/subvideo.mp4). 1회 재생 후 onEnded 에서
// pause() 로 마지막 프레임에 고정 — 채팅(VoidDialogue) 이 그 정지된 프레임 위로
// fade-in. 클릭 시 영상을 끝 프레임으로 seek + pause 하여 즉시 스킵.
function ConversationScene({ onComplete }: { onComplete: () => void }) {
  const [introDone, setIntroDone] = useState(false)
  const videoRef = useRef<HTMLVideoElement>(null)

  function skipToEnd() {
    if (introDone) return
    const v = videoRef.current
    if (v) {
      try {
        if (Number.isFinite(v.duration)) v.currentTime = v.duration
        v.pause()
      } catch { /* swallow — pause/seek race is fine */ }
    }
    setIntroDone(true)
  }

  return (
    <div
      className={`relative w-screen h-screen bg-black overflow-hidden ${introDone ? '' : 'cursor-pointer'}`}
      onClick={skipToEnd}
    >
      <video
        ref={videoRef}
        src="/subvideo.mp4"
        autoPlay
        muted
        playsInline
        onEnded={() => { videoRef.current?.pause(); setIntroDone(true) }}
        className="absolute inset-0 w-full h-full object-cover"
      />
      {!introDone && (
        <p className="absolute bottom-6 right-6 text-white/30 text-[10px] tracking-[0.3em] uppercase pointer-events-none">
          click to skip
        </p>
      )}
      {introDone && (
        <div className="absolute inset-0 animate-[fadeIn_900ms_ease-out]">
          <VoidDialogue onComplete={onComplete} />
        </div>
      )}
    </div>
  )
}