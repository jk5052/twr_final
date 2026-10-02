# Talisman Card 생성 로직

엔드게임의 마지막 단계인 `card` phase 에서 만들어지는 **A6 2-page PDF** (talisman) 가 어떻게 조립되는지 정리한 문서.

- **클라이언트 진입점**: `twr/components/CardOverlay.tsx`
- **오케스트레이터 API**: `twr/app/api/card-bundle/route.ts`
- **이미지 생성 API**: `twr/app/api/generate-card/route.ts`
- **시 매칭 API**: `twr/app/api/find-poems/route.ts`
- **무드 단어 추출**: `twr/lib/moodExtraction.ts`
- **렌더러**: `twr/components/TalismanPDF.tsx` (A6, 2 pages)

## 1. 전체 흐름

```
sealing → letter-compose (+ share?) → letter (receive) → letter-reply → card
                                                                         │
                                                                         ▼
                                                CardOverlay
                                                   │ POST
                                                   ▼
                                            /api/card-bundle      (idempotent)
                                                   │
       ┌───────────────────────────────────────────┼─────────────────────────┐
       ▼                                           ▼                         ▼
 extractMoodWords()                       /api/generate-card        /api/find-poems
 (Claude Sonnet 4.5)                      (Flux Schnell / Replicate) (pgvector match)
       │                                           │                         │
       └──────────► picked_words ──────────────────┤                         │
                                                   ▼                         ▼
                                            generated_cards row (Supabase)
                                                   │
                                                   ▼
                                              TalismanPDF (A6 ×2)
```

엔드게임은 **compose-first** 로 흐릅니다 — sealing 직후 player 가 자기 편지를 먼저 쓰고 (`letter-compose`, 이때 `composed_letter_embedding` 이 만들어짐), 그 임베딩을 키로 `match_letter_for_session_v2` 가 같은 lane 안에서 가장 가까운 seed letter 를 골라 보여주고 (`letter`), player 가 사적인 답장을 쓴 뒤 (`letter-reply`) `card` 로 진입. share 결정은 `letter-compose` 단계 안에서 같이 처리.

`card-bundle` 은 **멱등**합니다. 동일 `session_id` 로 여러 번 호출되어도 첫 호출에서만 Flux/시 매칭이 실행되고, 이후엔 `generated_cards` 행을 그대로 반환합니다.

## 2. 입력 — 세션이 끌어모은 player 데이터

`card-bundle` 이 카드를 만들기 전에 Supabase 에서 다음을 읽습니다:

| 테이블 | 용도 |
|---|---|
| `session_analysis` | `primary_defense` (28 codebook 중 하나) — Flux 프롬프트의 seed |
| `blank_fill_responses` | 빈칸채우기 본문 → Flux `woven element` |
| `final_reflections` | sealing 단계 답변 3개 → PDF page 1 본문 |
| `narrative_logs` / `journals` | mood extraction 의 raw 입력 |
| `letter_exchanges` | 공유된 reply letter id → QR code URL |

`primary_defense` 는 `defense_positive_framing.json` 의 키로 사용되어 다음 두 필드를 꺼냅니다:
- `framing_en` — 그 방어기제의 **positive reframe** 한 문장
- `image_seed` — Gorey 풍 일러스트의 중심 모티프 한 줄

## 3. Mood word 추출 — `lib/moodExtraction.ts`

Anthropic **Claude Sonnet 4.5** 를 `tool_use` 모드로 호출. system prompt 는 "방어기제 이름이나 진단 어휘를 절대 쓰지 말고, 플레이어 자신의 언어에서 4–7 개의 짧은 symbolic phrase 를 들어 올려라" — 즉 분류가 아니라 **vocabulary lifting**.

- 입력: `narrative_logs.event_text/response`, `journals.response`, `final_reflections.answer_text`, `blank_fill` 답변
- 출력: `string[]` (4–7 개, lowercase, ≤ 7 단어/구)
- 안전: `stripLoneSurrogates()` 로 lone UTF-16 surrogate 제거 (player free text 가 emoji 반쪽 등을 포함해 Anthropic strict JSON parser 가 reject 하던 502 문제 방지)

이 phrase 들은 **두 군데에 동시 사용**됩니다:
1. Flux 프롬프트의 `atmospheric anchors` 라인으로 들어가 이미지 무드를 결정
2. `generated_cards.picked_words` 컬럼에 그대로 저장 → PDF page 1 하단에 verbatim 노출

> 참고: 방 안에서 choice 마다 줍는 **readymade card** 픽업은 **별개**의 시스템입니다 — `data/readymadeCards.ts` 의 `pickReadymadeCard()` 가 PNG 풀에서 한 장씩 골라 `gameStore.collectedCards` 에 누적, 방-사이 `JournalingOverlay` 의 타로 fan-out 에서 골라잡힘 (자세한 건 `ORACLE_WORDS.md` 참고). 카드 id 와 카드 이미지 자체는 `card-bundle` 페이로드에 들어가지 않아 talisman 으로 직접 전달되지 않습니다. 단, 카드 자극을 받아 player 가 쓴 `journals.response` 텍스트는 mood extraction 의 raw 입력으로 흘러들어가는 간접 경로는 있음.

## 4. 이미지 생성 — `api/generate-card`

**Replicate / Flux Schnell** (`black-forest-labs/flux-schnell`).

| Parameter | Value |
|---|---|
| `aspect_ratio` | `2:3` (Brother VC500W 50×76mm 라벨 비율과 일치) |
| `output_format` | `png` (@react-pdf/image 가 PNG/JPG/SVG 만 sniff) |
| `megapixels` | `1` |
| `num_inference_steps` | `4` (Schnell 의 권장 sweet spot) |
| `go_fast` | `true` |

호출은 `Prefer: wait=30` 헤더로 sync 시도 → 미완 시 `urls.get` 을 1.5s 간격으로 폴링 (`maxDuration: 60`).

### Prompt 구조 (`generate-card/route.ts` L72–88)

순서가 중요합니다 — Flux 는 앞쪽 토큰에 더 큰 가중치:

1. **Negative 강제** — `absolutely no text, no captions, no labels, no titles, no nameplates, no inscriptions, no letters, no numerals, no logos, no watermarks`
2. **배경 강제** — `no pure white background, no clean studio backdrop, no rectangular inner frame, no inner border` (PDF 의 cream frame 안에 흰 사각형이 박혀 보이는 사고 방지)
3. **본체** — `Edward Gorey-style vintage oracle card illustration: ${image_seed}`
4. **의미** — `quiet meaning: ${framing_en}`
5. **player 흔적** — `woven element: "${blank_answer}"` (선택), `atmospheric anchors: "${mood1}", "${mood2}"...` (선택, 상위 4 개)
6. **스타일 anchor** — `fine pen-and-ink crosshatching and stippling, solid black linework, vintage oracle deck in the spirit of the Fantod Pack, single symbolic object, centered, dignified composition, generous negative space, aged warm cream paper (#f4ede1) with subtle mottling, faint foxing, soft paper grain, no humans, no faces, no figures, no threatening imagery, quiet mysterious warm contemplative slightly antique mood`

성공 시 `output[0]` 을 `image_url` 로 `generated_cards` 에 insert. `prompt_used` 컬럼에 최종 프롬프트 그대로 보관 (재현성/디버깅용).

## 5. 시 매칭 — `api/find-poems`

`poems_rag` 테이블에 사전 큐레이팅된 시들이 OpenAI `text-embedding-3-large` (3072d, `halfvec`) 로 임베딩되어 들어있음. `match_poems` RPC 가 player 의 `blank_fill_responses.answer_embedding` 과 **같은 primary_defense 레인 안에서** 코사인 유사도 top-1 을 반환. lane 매칭 결과가 비면 lane 없이 전체에서 top-1 fallback.

매칭된 시의 `title / author / content` 가 `generated_cards.card_poem*` 에 스냅샷되어 PDF page 2 의 본문이 됨 — 추후 동일 PDF 를 다시 만들어도 결과가 동일.

## 6. QR code

`letter_exchanges.reply_letter_id` 가 비어있지 않으면 (= player 가 `letter-compose` 단계에서 share=true 를 선택해 자신의 **composed** 편지가 `seed_letters` 에 `source='player'` 로 등록됐으면) `${origin}/letter/${reply_letter_id}` 를 `qrcode` 라이브러리로 PNG data URL 생성 → `generated_cards.qr_url` + `qr_data_url` 저장. 공유 안 한 경우 QR 영역은 비고 PDF page 2 의 footer 가 `the white room` 만 표시.

> 컬럼명 주의: `reply_letter_id` 는 mig. `13` 시절 "공유된 reply" 를 가리키도록 도입됐지만 mig. `18` 의 compose-first flip 이후로는 **공유된 composed 편지의 id** 를 담습니다. 이름은 back-compat 으로 유지된 채. 같은 행의 `received_letter_id` (player 가 받은 seed 편지) 와 의미가 겹치게 보이지만 두 컬럼은 별개입니다 — 자세한 부채 메모는 `TECH_OVERVIEW.md` §16 참고.

## 7. PDF 조립 — `TalismanPDF.tsx`

A6 portrait (105×148mm) **2 페이지**, 모두 cream paper `#f4ede1` 배경 + ink `#1a1a1a`:

### Page 1 — Oracle
- `imageUrl` (Flux 결과) — 2:3 박스 안에 cover
- `sealingAnswers` — sealing ritual 의 3 문장 (player 자필)
- `moodWords` — Sonnet 4.5 가 뽑은 4–7 phrase 를 한 줄로 나열

### Page 2 — Poem
- `poemTitle` / `poemAuthor` / `poem` (page 2 본문)
- `replyText` — player 가 letter-reply 단계에서 쓴 사적 답장 (silent 일 경우 `·` 단일 글리프)
- 좌하 `the white room` 브랜드 + `qrUrl` 텍스트, 우하 `qrDataUrl` 50×50 QR

`defenseFraming / defenseName / blankAnswer` 는 `TalismanData` 에 들어오긴 하지만 page 1 에는 렌더되지 않습니다 (option X — 내부/seed 용). 50mm 라벨 PDF (`TalismanLabelPDF.tsx`) 는 별도 컴팩트 레이아웃에서 `defenseName` 만 사용.

## 8. 멱등성과 재생성

- `generated_cards.session_id` 가 PRIMARY KEY → 동일 세션 1행 보장
- `card-bundle` 진입 시 행 존재 + `image_url` 이 PDF-safe 포맷이면 **재생성 없이 통과**
- `image_url` 이 webp 등으로 저장돼 있으면 (구버전 데이터) 그 행을 삭제 후 generate-card 재호출
- 시/QR 은 각각 자기 컬럼이 비어있을 때만 채움 → 부분 실패에서도 복구 가능

## 9. Readymade cards (`public/models/readymade_cards/`)

talisman 파이프라인에서는 **참조되지 않습니다.** Flux 실패 시 자동 fallback 으로 빠지지도 않음 — 그 경우 `card-bundle` 이 502 를 던지고 `CardOverlay` 가 `failed: …` 에러를 표시. 자동 fallback 이 필요해지면 `generate-card` 의 `pred.status !== 'succeeded'` 분기에서 랜덤 picked file 로 대체하는 패치가 들어가야 합니다.

다만 **같은 폴더는 in-game 카드 픽업 시스템**의 자산 소스로 활발히 쓰입니다 — 방 안에서 choice 마다 한 장씩 줍고 (`CardToast`), 방-사이 `JournalingOverlay` 의 타로 fan-out 에서 골라잡는 그 카드들이 이 PNG 들. 두 경로 (talisman / in-game) 가 한 폴더를 공유하지만 의미적으로는 분리되어 있고, 자세한 건 `ORACLE_WORDS.md`.

## 10. 손볼 만한 곳

- Flux 실패 시 readymade pool 로 graceful fallback
- `picked_words` 길이 4 cap → 무드 분포가 풍부한 세션에선 가시성 떨어짐. PDF 가 7 개 전부 받도록 `slice(0, 4)` 완화 검토
- `extractMoodWords` 와 `getOrCreateSessionAnalysis` 가 동일 raw 소스를 두 번 fetch — 캐시 공유 여지
