# In-Game Card Pickup 로직

방 1–4 플레이 중 player 가 **각 choice 마다 한 장씩 줍는 readymade 카드** — 좌측 하단 `카드 획득 +1` toast 로 알려지고, 방-사이 `JournalingOverlay` 의 타로 fan-out 에서 2–3 장을 골라 잡는 — 가 어떻게 흘러가는지 정리한 문서.

이건 talisman PDF 의 `moodWords` 와도, Flux 가 생성하는 talisman 이미지와도 **별개의 시스템**입니다. (talisman 쪽은 `CARD_GENERATION.md` 참고.)

- **카드 풀**: `twr/data/readymadeCards.ts` (`READYMADE_CARD_IDS`, `pickReadymadeCard`)
- **이미지**: `twr/public/models/readymade_cards/{1..45}.png` (17, 44 결번 — 43 장)
- **픽 트리거**: `twr/app/page.tsx` `EventOverlay.onChoose` 콜백 (L282)
- **저장**: `twr/stores/gameStore.ts` (`collectedCards: number[]`, `addCard`)
- **알림**: `twr/components/CardToast.tsx` (좌하 1.8 s fade)
- **소비처**: `twr/components/JournalingOverlay.tsx` (방-사이 타로 fan-out)
- **서버 신호**: `/api/journal-prompt` 의 `seed_cards` 페이로드

## 1. 카드 풀 — `data/readymadeCards.ts`

LLM 호출 없는 **정적 PNG 풀**. 43 장 (`1..45` 중 `17`, `44` 결번). 각 PNG 는 미리 외부 도구 (Midjourney/Flux 등) 로 만든 추상 일러스트레이션 — 코드는 id 만 다루고 의미를 모름.

```ts
export const READYMADE_CARD_IDS: readonly number[] = [
  1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15, 16,
  18, 19, 20, 21, 22, 23, 24, 25, 26, 27, 28, 29, 30, 31, 32, 33,
  34, 35, 36, 37, 38, 39, 40, 41, 42, 43, 45,
]

export const cardImagePath = (id: number) => `/models/readymade_cards/${id}.png`

export function pickReadymadeCard(owned: readonly number[]): number | null {
  const ownedSet = new Set(owned)
  const remaining = READYMADE_CARD_IDS.filter((id) => !ownedSet.has(id))
  if (remaining.length === 0) return null
  return remaining[Math.floor(Math.random() * remaining.length)]
}
```

> 같은 폴더는 `api/generate-card` 가 Flux 실패 시 fallback 으로 (이론상) 쓸 수도 있는 자리지만, 현재 코드 경로에서는 talisman 생성에 참조되지 않습니다 — in-game 픽업 과 talisman 은 같은 PNG 폴더만 공유, 의미적으로는 분리됩니다.

## 2. 트리거 — 매 choice 직후

`page.tsx` 의 `EventOverlay onChoose` 콜백 안 (L282 부근):

```tsx
const nextCard = pickReadymadeCard(useGameStore.getState().collectedCards)
if (nextCard != null) {
  addCard(nextCard)
  setCardToastBump((b) => b + 1)
}
```

즉 **각 인터랙티브 아이템의 각 choice 마다 1 장씩 추가**. EventOverlay 한 chain 이 4 단계면 4 장이 누적. 방 4 개 (R1–R4) × 평균 5 chain × 3 단계 ≈ 한 세션 ~60 회 픽 호출이지만 풀이 **43 장에서 소진**되면 `pickReadymadeCard` 가 `null` 을 반환해 더 이상 toast 가 안 뜸. 중복은 `gameStore.addCard` 가 이중 안전망으로 차단.

LLM/네트워크 호출 없음 → 클릭과 동시에 즉각적으로 toast 가 뜸.

## 3. 저장 — Zustand `gameStore.collectedCards`

```ts
collectedCards: number[]    // 누적 readymade card id — choice마다 1개 append

addCard: (id) => set((state) =>
  state.collectedCards.includes(id)
    ? state
    : { collectedCards: [...state.collectedCards, id] }
),
```

- **in-memory only** — Supabase 등 영속 저장소에 안 들어감. 탭 새로고침 시 소실.
- `resetForNewPlay()` 가 landing → intro 전환 시 `[]` 로 리셋 → 새 세션에 풀이 섞이지 않음.
- choice 자체는 `narrative_logs` 로 별도 영속화되지만 거기에는 picked card id 가 포함되지 않음.

## 4. 알림 — `CardToast`

좌하 (`bottom-8 left-8`) 고정. `pointer-events-none`. `trigger` (단조 증가 카운터) 가 바뀔 때마다 1.8 s 동안 `카드 획득 +1` 텍스트가 fade-in/out. 카드 이미지 자체는 toast 에 안 뜸 — **수집의 사실만 알리고 내용은 다음 phase 에 가서 본다** 는 페이싱.

## 5. 소비처 — `JournalingOverlay` 타로 fan-out

방-사이 (R1→R2, R2→R3, R3→R4, R4→R5) 전환 직전에 띄우는 `JournalingOverlay` 가 `collectedCards` 를 `seedCards` prop 으로 받습니다 (`page.tsx` L321). UI 흐름:

1. **pick 단계** (`seedCards.length >= 2` 일 때만):
   - 카드들이 한 곳에 쌓인 (deck) 상태로 마운트 → 120 ms 후 `fanned = true` → 각 카드가 `transitionDelay: i * 70ms` 로 부채꼴 (fan) 로 펼쳐짐
   - `transform-origin: bottom center` 라 회전축이 카드 밑변 → **실제 카드를 손에 쥐고 펼치는 듯한 동선**
   - 적응 spread: `maxAngle = min(70, 14 + n*5)`, `spread = min(n*70, 760)` — 적은 장수는 좁게, 많을수록 화면 폭(viewport-wide, `w-screen -mx-8`) 까지 넓게
   - 호버 시 -5 lift, picked 시 -10 lift + 카드 뒤 백색/연보라 halo glow
   - player 가 **2–3 장** 골라잡고 `continue ▸` (또는 `skip`)
2. picked 배열 확정 → `/api/journal-prompt` POST `{ session_id, from_room, recent_event, seed_cards: picked }`
3. **writing 단계**: LLM 이 돌려준 2-line 프롬프트와 함께 picked 카드의 **작은 썸네일** 줄이 상단에 노출. player 가 자유 답변 작성
4. submit/skip → `journals` 테이블 insert → 다음 방으로

`seedCards.length < 2` 면 pick 단계 스킵하고 곧장 prompt fetch (마운트 1회).

## 6. 서버 신호 — `seed_cards` 가 LLM 프롬프트에 들어가는 방식

`/api/journal-prompt` 는 `seed_cards: number[]` 를 받아 **개수만** LLM user 메시지에 신호로 끼워 넣습니다 (`route.ts` L119–130):

```ts
const pickedCount = Array.isArray(body.seed_cards) ? body.seed_cards.length : 0
const cardLine = pickedCount > 0
  ? `PICKED: the player just chose ${pickedCount} image${pickedCount === 1 ? '' : 's'} they could not look away from.`
  : null
const user = [
  `ANCHOR: ${anchor}`,
  ...(cardLine ? ['', cardLine] : []),
  '',
  cardLine
    ? 'Write the journaling prompt now. Begin from the pull of the image they just chose, then enter the anchor as the concrete sensory ground. Two lines. Do not name the image itself.'
    : 'Write the journaling prompt now. Two lines. Stay with the anchor.',
].join('\n')
```

핵심 결정:
- **id 자체는 안 넘김** — Flux 가 만든 추상 이미지를 LLM 이 못 보니까 의미가 없다. "**N 장의 이미지가 끌어당겼다**" 는 사실만 신호로 전달
- ANCHOR (`a doorway`, `a thread`, `a kept secret`, …) 는 여전히 라우트 안 33 개 풀에서 랜덤 픽 — concrete sensory grounding 의 역할
- 결과적으로 LLM 은 **이미지의 끌림 → anchor 의 sensory 입구** 순서로 2 줄 프롬프트를 작성

> `seed_words: string[]` 필드는 인터페이스에 남아 있지만 legacy — 라우트가 받기는 받아도 읽지 않음. 코드 주석에 `legacy — 안 쓰임` 으로 명시됨.

## 7. talisman 과의 관계

- talisman PDF 의 page 1 하단 `moodWords` 는 `lib/moodExtraction.ts` 가 Sonnet 4.5 로 player 의 raw text (`narrative_logs.response`, `journals.response`, `final_reflections.answer_text`, blank_fill 답변) 에서 추출하는 **별개 vocabulary**
- player 가 in-game 에서 픽한 `collectedCards` 는 **talisman 으로 전달되지 않음** (`card-bundle` 이 store 를 못 봄, 서버에서 픽업 분포의 출처조차 모름). 단, journal 응답이 카드 자극을 받은 텍스트라면 그 텍스트 자체가 `journals.response` → mood extraction → talisman 으로 흘러가는 **간접 경로**는 존재
- Flux 가 그리는 talisman 이미지는 readymade_cards/ 폴더와 동일한 PNG 폴더에 떨어지지 않음 (별도 `image_url` 컬럼) — 시각적으로 readymade 와 같은 가족처럼 보일 수 있지만 자산 경로가 다름

## 8. Legacy — 이전의 oracle words 시스템

이전 버전에서는 같은 슬롯에 **단어 phrase 픽업** 시스템이 있었습니다:

- 풀: `twr/data/oracleWords.ts` 의 80 개 evocative phrase (`time`, `space`, `weather`, `body`, `object`, `feeling`, `motion`, `fragment` × 10)
- 픽 함수: `pickOracleWords(n = 3)` — `data/oracleWords.ts` 에 여전히 존재
- 저장: `gameStore.collectedWords: string[]` — 스토어에 **legacy 로 남아 있되 더 이상 채워지지 않음** (주석: `legacy 오라클 단어 — 더 이상 채워지지 않음 (CardToast 로 대체)`)
- 표시: `components/CollectedWordsPanel.tsx` — 코드 파일은 존재하지만 `page.tsx` 에서 더 이상 import / 렌더되지 않음
- 소비처: 이전 `JournalingOverlay` 가 phrase 풀을 받아 pick → `seed_words` 로 POST 했지만 라우트에서 무시되던 (의례용) 단계

**전환 동기**:
- 텍스트 phrase 는 LLM 이 직접 읽을 수 있어서 "끌어당김" 이라는 비-언어적 직관을 흐림. 추상 이미지로 바꾸면 player 는 말로 정리되지 않는 픽을 강제 받고, 서버는 그 픽 자체가 아니라 **픽의 사실** 만 받는다 — 자기 정리의 책임이 player 쪽에 머무름
- 한 chain 에 3 개씩 쌓이던 phrase 가 60 개 안팎까지 누적되며 화면 우상단을 잠식하던 정보 과부하 해소

`oracleWords.ts` / `CollectedWordsPanel.tsx` / `addOracleWords` / `collectedWords` 는 **재진입 대비 보존** 상태. 다시 켜고 싶다면 `page.tsx` 의 `onChoose` 에 `addOracleWords(pickOracleWords(3))` 한 줄 + `<CollectedWordsPanel words={collectedWords} />` 한 줄을 되살리면 됨.

## 9. 손볼 만한 곳

- **카드 id → 의미 라벨**: 현재 카드 id 는 추상. 풀에 `tags: string[]` (예: `'thread'`, `'window'`, `'mirror'`) 컬럼을 붙이면 `/api/journal-prompt` 가 picked 카드의 태그 한두 개를 anchor 대신 LLM 에 전달할 수 있음 — "이미지가 끌어당겼다" 보다 한 단계 더 깊은 신호
- **carded 분포 영속화**: `journals.picked_card_ids int[]` 컬럼 추가하여 nightly 분석 시 카드 픽 분포 → 방어기제 lane 과의 상관 추적
- **talisman 통합**: card-bundle 에 `picked_card_ids` 를 추가 페이로드로 보내 talisman page 1 가장자리에 작은 thumbnail strip 으로 노출 (player 가 in-game 에서 본 카드들과 마지막 talisman 이 만나는 closure)
- **풀 확장**: 현재 43 장. 한 세션이 ~60 회 픽 호출이라 후반 chain 에선 `null` 이 빈번 (toast 가 안 뜸) — 60+ 로 늘리거나 풀이 비었을 때 fallback toast 문구 추가
