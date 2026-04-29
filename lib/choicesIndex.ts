// In-memory mirror of choices_rag (≈200 rows) loaded once per page load so the
// browser can snapshot defense/3-axis/VAD labels into narrative_logs at insert
// time without an extra round-trip per choice.
//
// 게임 내 ENTRY chain은 ENTRY_ITEM_ID('__entry__')로 식별되지만 choices_rag에는
// item_id='room_entry'로 적재되어 있다 (10_extract_choices.py 참조). 룩업/스냅샷
// 모두 정규화된 'room_entry' 키를 사용한다.
import { getSupabase } from './supabase'
import { ENTRY_ITEM_ID } from '@/data/events'

export interface ChoiceSnapshot {
  primary_defense:   string | null
  secondary_defense: string | null
  defense_weights:   unknown
  vaillant_level:    string | null
  metaphors:         string[]
  operations:        string[]
  motifs:            string[]
  valence:           number | null
  arousal:           number | null
  dominance:         number | null
}

const SNAPSHOT_COLS =
  'room, item_id, event_index, choice_index, ' +
  'primary_defense, secondary_defense, defense_weights, vaillant_level, ' +
  'metaphors, operations, motifs, valence, arousal, dominance'

const cache = new Map<string, ChoiceSnapshot>()
let loadOnce: Promise<void> | null = null

export function normalizeItemId(itemId: string): string {
  return itemId === ENTRY_ITEM_ID ? 'room_entry' : itemId
}

function key(room: number, itemId: string, eventIndex: number, choiceIndex: number) {
  return `${room}|${normalizeItemId(itemId)}|${eventIndex}|${choiceIndex}`
}

export function preloadChoicesIndex(): Promise<void> {
  if (loadOnce) return loadOnce
  loadOnce = (async () => {
    const sup = getSupabase()
    const { data, error } = await sup
      .from('choices_rag')
      .select(SNAPSHOT_COLS)
      .eq('applicable', true)
    if (error) {
      // failure should not break the game — labels just won't be snapshotted.
      console.warn('[choicesIndex] preload failed:', error.message)
      return
    }
    for (const row of data ?? []) {
      const r = row as unknown as Record<string, unknown> & {
        room: number; item_id: string; event_index: number; choice_index: number
      }
      cache.set(key(r.room, r.item_id, r.event_index, r.choice_index), {
        primary_defense:   (r.primary_defense   as string | null) ?? null,
        secondary_defense: (r.secondary_defense as string | null) ?? null,
        defense_weights:   r.defense_weights ?? [],
        vaillant_level:    (r.vaillant_level    as string | null) ?? null,
        metaphors:  (r.metaphors  as string[]) ?? [],
        operations: (r.operations as string[]) ?? [],
        motifs:     (r.motifs     as string[]) ?? [],
        valence:    (r.valence    as number | null) ?? null,
        arousal:    (r.arousal    as number | null) ?? null,
        dominance:  (r.dominance  as number | null) ?? null,
      })
    }
  })()
  return loadOnce
}

export function lookupChoice(
  room: number, itemId: string, eventIndex: number, choiceIndex: number,
): ChoiceSnapshot | null {
  return cache.get(key(room, itemId, eventIndex, choiceIndex)) ?? null
}

export function choicesIndexSize(): number {
  return cache.size
}
