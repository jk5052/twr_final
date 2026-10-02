// In-game card collection pool. Images live in /public/models/readymade_cards/
// and are numbered 1..45 with 17 and 44 missing — 43 cards total. The same
// folder is also referenced by /api/generate-card as a fallback when Flux
// fails; in-game pickup is unrelated to that path, it just reuses the assets.

export const READYMADE_CARD_IDS: readonly number[] = [
  1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15, 16,
  18, 19, 20, 21, 22, 23, 24, 25, 26, 27, 28, 29, 30, 31, 32, 33,
  34, 35, 36, 37, 38, 39, 40, 41, 42, 43, 45,
]

export const cardImagePath = (id: number): string =>
  `/models/readymade_cards/${id}.png`

// Random pick excluding ids in `owned`. Returns null if the deck is exhausted.
// Called from /app/page.tsx on every EventOverlay choice — each pick adds
// one card id to gameStore.collectedCards.
export function pickReadymadeCard(owned: readonly number[]): number | null {
  const ownedSet = new Set(owned)
  const remaining = READYMADE_CARD_IDS.filter((id) => !ownedSet.has(id))
  if (remaining.length === 0) return null
  return remaining[Math.floor(Math.random() * remaining.length)]
}
