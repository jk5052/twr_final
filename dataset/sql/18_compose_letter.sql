-- ============================================================
-- The White Room — compose-letter flow
--   Reworks the endgame sequence so the player writes their own
--   letter BEFORE seeing any matched letter:
--     sealing(3)
--       → letter-compose  (pick one sealing answer + write letter + share?)
--       → letter          (receive matched, display only)
--       → card
--
--   Schema additions on letter_exchanges store the composed letter
--   and its embedding so the match RPC can key on the player's
--   actual writing instead of the first sealing answer.
--
--   seed_letters.blank_answer_embedding is reused as the matching
--   embedding field — when source='player', it now holds the
--   composed letter's embedding (not the sealing answer's). The
--   column name is kept for backward compat with v1 RPCs.
--
-- Run AFTER 17_final_reflections.sql in Supabase SQL Editor.
-- ============================================================

-- (1) letter_exchanges — new columns for compose phase --------
alter table public.letter_exchanges
  alter column received_letter_id drop not null;

alter table public.letter_exchanges
  add column if not exists composed_letter           text,
  add column if not exists composed_letter_embedding halfvec(3072),
  add column if not exists selected_template_id      int references public.blank_fill_templates(id),
  add column if not exists selected_answer           text,
  add column if not exists share_choice              boolean,
  add column if not exists composed_at               timestamptz;

create index if not exists letter_exchanges_composed_idx
  on public.letter_exchanges (session_id)
  where composed_letter is not null;

-- (2) match_letter_for_session_v2 -----------------------------
--   Keys on letter_exchanges.composed_letter_embedding; lane
--   still comes from blank_fill_responses.primary_defense to
--   keep the defense-anchored matching signal intact.
--   Returns 0 or 1 row (top-5 cosine, then random).
create or replace function public.match_letter_for_session_v2(p_session_id uuid)
returns table (
  letter_id        uuid,
  letter_text      text,
  primary_defense  text,
  author_pseudonym text,
  source           text,
  blank_answer     text,
  similarity       real
)
language sql
stable
as $$
  with me as (
    select le.session_id,
           le.composed_letter,
           le.composed_letter_embedding,
           bfr.primary_defense
      from public.letter_exchanges le
      join public.blank_fill_responses bfr on bfr.session_id = le.session_id
     where le.session_id = p_session_id
       and le.composed_letter_embedding is not null
     limit 1
  ),
  ranked as (
    select sl.id   as letter_id,
           sl.letter_text,
           sl.primary_defense,
           sl.author_pseudonym,
           sl.source,
           sl.blank_answer,
           (1 - (sl.blank_answer_embedding <=> (select composed_letter_embedding from me)))::real
             as similarity
      from public.seed_letters sl, me
     where sl.active = true
       and sl.blank_answer_embedding is not null
       and sl.primary_defense = me.primary_defense
       and (sl.origin_session_id is null or sl.origin_session_id <> me.session_id)
     order by sl.blank_answer_embedding <=> (select composed_letter_embedding from me) asc
     limit 5
  )
  select * from ranked order by random() limit 1;
$$;

create or replace function public.match_letter_for_session_v2_any(p_session_id uuid)
returns table (
  letter_id        uuid,
  letter_text      text,
  primary_defense  text,
  author_pseudonym text,
  source           text,
  blank_answer     text,
  similarity       real
)
language sql
stable
as $$
  with me as (
    select le.session_id,
           le.composed_letter_embedding
      from public.letter_exchanges le
     where le.session_id = p_session_id
       and le.composed_letter_embedding is not null
     limit 1
  ),
  ranked as (
    select sl.id   as letter_id,
           sl.letter_text,
           sl.primary_defense,
           sl.author_pseudonym,
           sl.source,
           sl.blank_answer,
           (1 - (sl.blank_answer_embedding <=> (select composed_letter_embedding from me)))::real
             as similarity
      from public.seed_letters sl, me
     where sl.active = true
       and sl.blank_answer_embedding is not null
       and (sl.origin_session_id is null or sl.origin_session_id <> me.session_id)
     order by sl.blank_answer_embedding <=> (select composed_letter_embedding from me) asc
     limit 5
  )
  select * from ranked order by random() limit 1;
$$;

-- (3) share_player_letter — rewritten for composed-letter flow
--   Inserts seed_letters using letter_exchanges.composed_letter as
--   letter_text and composed_letter_embedding as the matching key
--   (stored in blank_answer_embedding column for RPC compat).
--   selected_template_id / selected_answer are snapshotted into
--   blank_template_id / blank_answer respectively so future
--   "what was the anchor" lookups work without joining sessions.
--   Idempotent on letter_exchanges.reply_letter_id.
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
         le.selected_template_id,
         le.selected_answer,
         le.composed_letter_embedding,
         le.composed_letter,
         p_session_id,
         p_player_id,
         true
    from public.letter_exchanges le
    join public.blank_fill_responses bfr on bfr.session_id = le.session_id
   where le.session_id = p_session_id
     and le.composed_letter           is not null
     and le.composed_letter_embedding is not null
     and coalesce(le.share_choice, false) = true
  returning id into v_new;

  if v_new is null then
    raise exception 'no shareable composed letter for session %', p_session_id;
  end if;

  update public.letter_exchanges
     set reply_letter_id = v_new
   where session_id = p_session_id;

  return query select v_new;
end;
$$;

-- verification:
--   select column_name, data_type from information_schema.columns
--    where table_name = 'letter_exchanges'
--      and column_name in ('composed_letter','composed_letter_embedding',
--                         'selected_template_id','selected_answer',
--                         'share_choice','composed_at');
--   select proname from pg_proc
--    where proname in ('match_letter_for_session_v2',
--                      'match_letter_for_session_v2_any',
--                      'share_player_letter');
