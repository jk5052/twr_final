-- ============================================================
-- The White Room — letter sharing + external replies
--   (a) seed_letters.origin_player_id
--         persistent (localStorage) author id; lets the QR landing
--         page distinguish the author from a stranger when the
--         author's session_id is gone (different tab/device).
--   (b) generated_cards.card_poem / qr_url
--         pinned poem + qr_url snapshot for the talisman card.
--   (c) letter_replies
--         external responses to a shared letter via QR scan.
-- Run AFTER 10_endgame_schema.sql.
-- ============================================================

alter table public.seed_letters
  add column if not exists origin_player_id text;

create index if not exists seed_letters_origin_player_idx
  on public.seed_letters (origin_player_id);

alter table public.generated_cards
  add column if not exists card_poem text,
  add column if not exists qr_url    text;

create table if not exists public.letter_replies (
  id                bigserial primary key,
  shared_letter_id  uuid not null references public.seed_letters(id) on delete cascade,
  reply_text        text not null,
  reply_player_id   text,                  -- best-effort identifier of the responder
  reply_session_id  uuid,                  -- if the responder happens to be in-game
  delivered         boolean default false, -- author has seen this reply
  created_at        timestamptz default now()
);
create index if not exists letter_replies_letter_idx
  on public.letter_replies (shared_letter_id);
create index if not exists letter_replies_undelivered_idx
  on public.letter_replies (shared_letter_id) where delivered = false;

alter table public.letter_replies disable row level security;

-- ------------------------------------------------------------
-- (d) share_player_letter(p_session_id, p_player_id) RPC
--     atomically ingests the player's reply into seed_letters
--     (source='player'), reusing the player's own blank_answer
--     embedding so the matching key stays consistent. Pins the
--     new letter id onto letter_exchanges.reply_letter_id.
--     Idempotent — returns the existing reply_letter_id when set.
-- ------------------------------------------------------------
create or replace function public.share_player_letter(
  p_session_id uuid,
  p_player_id  text
)
returns table (shared_letter_id uuid)
language plpgsql
as $$
declare
  v_existing uuid;
  v_new      uuid;
begin
  select reply_letter_id into v_existing
    from public.letter_exchanges
   where session_id = p_session_id;

  if v_existing is not null then
    return query select v_existing;
    return;
  end if;

  insert into public.seed_letters
    (source, primary_defense, blank_template_id,
     blank_answer, blank_answer_embedding, letter_text,
     origin_session_id, origin_player_id, active)
  select 'player',
         bfr.primary_defense,
         bfr.template_id,
         bfr.answer,
         bfr.answer_embedding,
         le.reply_text,
         p_session_id,
         p_player_id,
         true
    from public.letter_exchanges le
    join public.blank_fill_responses bfr on bfr.session_id = le.session_id
   where le.session_id = p_session_id
     and le.reply_text is not null
  returning id into v_new;

  if v_new is null then
    raise exception 'no reply to share for session %', p_session_id;
  end if;

  update public.letter_exchanges
     set reply_letter_id = v_new
   where session_id = p_session_id;

  return query select v_new;
end;
$$;

-- verification:
--   select column_name, data_type from information_schema.columns
--    where table_name in ('seed_letters','generated_cards')
--      and column_name in ('origin_player_id','card_poem','qr_url');
--   select to_regclass('public.letter_replies');
