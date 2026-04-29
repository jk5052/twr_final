// Per-choice writer for narrative_logs. Fire-and-forget from the browser:
// failures are logged to console but never block gameplay.
//
// Shape mirrors 06_runtime_schema.sql narrative_logs columns. We snapshot
// labels from choicesIndex (preloaded choices_rag) so re-running the labeler
// later won't rewrite history.
import { getSupabase } from './supabase'
import { lookupChoice, normalizeItemId } from './choicesIndex'
import { getPlayerId, getSessionId } from './session'

// Versions track the labeler that produced the snapshotted columns + the
// closed-vocab + codebook versions used (mirrors ensemble_retrieve.py).
export const MODEL_VERSION  = 'claude-sonnet-4-5'
export const SCHEMA_VERSION = 'vocab@1.0'

export interface LogChoiceInput {
  room:         number
  itemId:       string
  eventIndex:   number
  choiceIndex:  number
  prompt:       string
  label:        string
  tag:          string
  endChain:     boolean
  // runtime meta — survives in client_meta jsonb for future analytics
  latencyMs:    number
  changedMind:  boolean
  hoverSequence: string[]
}

export async function logChoice(input: LogChoiceInput): Promise<void> {
  const sessionId = getSessionId()
  const playerId  = getPlayerId()
  if (!sessionId) return

  const snap = lookupChoice(
    input.room, input.itemId, input.eventIndex, input.choiceIndex,
  )

  const row = {
    session_id:   sessionId,
    player_id:    playerId || null,
    room:         input.room,
    item_id:      normalizeItemId(input.itemId),
    event_index:  input.eventIndex,
    choice_index: input.choiceIndex,
    prompt:       input.prompt,
    label:        input.label,
    tag:          input.tag,
    end_chain:    input.endChain,
    primary_defense:   snap?.primary_defense   ?? null,
    secondary_defense: snap?.secondary_defense ?? null,
    defense_weights:   snap?.defense_weights   ?? [],
    vaillant_level:    snap?.vaillant_level    ?? null,
    metaphors:  snap?.metaphors  ?? [],
    operations: snap?.operations ?? [],
    motifs:     snap?.motifs     ?? [],
    valence:    snap?.valence   ?? null,
    arousal:    snap?.arousal   ?? null,
    dominance:  snap?.dominance ?? null,
    client_meta: {
      latency_ms:     input.latencyMs,
      changed_mind:   input.changedMind,
      hover_sequence: input.hoverSequence,
      ua: typeof navigator !== 'undefined' ? navigator.userAgent : null,
      locale: typeof navigator !== 'undefined' ? navigator.language : null,
    },
    model_version:  MODEL_VERSION,
    schema_version: SCHEMA_VERSION,
  }

  const sup = getSupabase()
  const { error } = await sup
    .from('narrative_logs')
    .upsert(row, { onConflict: 'session_id,room,item_id,event_index,choice_index' })
  if (error) {
    console.warn('[narrativeLog] upsert failed:', error.message, {
      room: row.room, item: row.item_id, ev: row.event_index, ci: row.choice_index,
    })
  }
}
