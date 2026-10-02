-- ============================================================
-- The White Room — letter-reply phase (compose-first runtime)
--   Adds the reply_at timestamp on letter_exchanges and
--   re-affirms reply_text. The schema additions in this file
--   are order-agnostic; the runtime ordering described below
--   reflects the live code (compose-first), which is the
--   inverse of an earlier draft of this header.
--
--   Live endgame order (app/page.tsx, post-flip):
--     sealing(3)
--       → letter-compose (write own letter, embed, share?)
--       → letter         (receive match keyed on composed_letter_embedding)
--       → letter-reply   (private reply to the received letter)
--       → card
--
--   Column meanings on letter_exchanges:
--     composed_letter / composed_letter_embedding
--                      = the player's own letter, written first.
--                        Embedding becomes the matching key for
--                        match_letter_for_session_v2 (mig. 18).
--                        Eligible for sharing into seed_letters
--                        when share_choice = true.
--     received_letter_id
--                      = pinned match from the v2 RPC.
--     reply_text       = private response to the received letter.
--                        NEVER inserted into seed_letters.
--                        Lives only on this row.
--     reply_at         = timestamp the reply was written (added below).
--
--   Matching (runtime):
--     /api/letter calls match_letter_for_session_v2 from
--     18_compose_letter.sql, keyed on
--     letter_exchanges.composed_letter_embedding. Lane filter
--     (primary_defense) still comes from blank_fill_responses
--     (mirrored by SealingOverlay → /api/blank-fill).
--     The v1 RPCs in 12_letter_match_rpc.sql are no longer
--     called by /api/letter but remain installed.
--
-- Run AFTER 18_compose_letter.sql in Supabase SQL Editor.
-- ============================================================

-- (1) letter_exchanges — add reply_at timestamp ---------------
alter table public.letter_exchanges
  add column if not exists reply_at timestamptz;

-- reply_text already exists (10_endgame_schema.sql). No-op if so.
alter table public.letter_exchanges
  add column if not exists reply_text text;

-- (2) Matching RPCs (no changes here) -------------------------
--   Live:  public.match_letter_for_session_v2(p_session_id uuid)
--          public.match_letter_for_session_v2_any(p_session_id uuid)
--          defined in 18_compose_letter.sql.
--   Dormant: public.match_letter_for_session(...)
--            public.match_letter_for_session_any(...)
--            from 12_letter_match_rpc.sql — installed but not
--            called by /api/letter under the compose-first flow.

-- (3) verification ---------------------------------------------
--   select column_name, data_type from information_schema.columns
--    where table_name = 'letter_exchanges'
--      and column_name in ('reply_text','reply_at');
--   select proname from pg_proc
--    where proname in ('match_letter_for_session_v2',
--                      'match_letter_for_session_v2_any');
