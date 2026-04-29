-- ============================================================
-- The White Room — letter matching RPC
--   match_letter_for_session(p_session_id uuid)
--     given a session that has filled blank_fill_responses
--     (with answer_embedding + primary_defense), pick one
--     seed_letters row in the same defense lane, excluding the
--     player's own answer/origin, ranked by cosine similarity
--     (top 5 closest), then randomized for variety.
--   Returns 0 or 1 row.
-- Run AFTER 10_endgame_schema.sql in Supabase SQL Editor.
-- ============================================================

create or replace function public.match_letter_for_session(p_session_id uuid)
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
    select session_id,
           answer,
           answer_embedding,
           primary_defense
      from public.blank_fill_responses
     where session_id = p_session_id
     limit 1
  ),
  ranked as (
    select sl.id   as letter_id,
           sl.letter_text,
           sl.primary_defense,
           sl.author_pseudonym,
           sl.source,
           sl.blank_answer,
           (1 - (sl.blank_answer_embedding <=> (select answer_embedding from me)))::real
             as similarity
      from public.seed_letters sl, me
     where sl.active = true
       and sl.blank_answer_embedding is not null
       and (me.answer_embedding is not null)
       and sl.primary_defense = me.primary_defense
       and (sl.origin_session_id is null or sl.origin_session_id <> me.session_id)
       and (sl.blank_answer is null or sl.blank_answer <> me.answer)
     order by sl.blank_answer_embedding <=> (select answer_embedding from me) asc
     limit 5
  )
  select * from ranked order by random() limit 1;
$$;

-- Fallback when the player's defense lane has no candidates:
-- pick across all active letters, still cosine-ranked, top-5 random.
create or replace function public.match_letter_for_session_any(p_session_id uuid)
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
    select session_id,
           answer,
           answer_embedding
      from public.blank_fill_responses
     where session_id = p_session_id
     limit 1
  ),
  ranked as (
    select sl.id   as letter_id,
           sl.letter_text,
           sl.primary_defense,
           sl.author_pseudonym,
           sl.source,
           sl.blank_answer,
           (1 - (sl.blank_answer_embedding <=> (select answer_embedding from me)))::real
             as similarity
      from public.seed_letters sl, me
     where sl.active = true
       and sl.blank_answer_embedding is not null
       and (me.answer_embedding is not null)
       and (sl.origin_session_id is null or sl.origin_session_id <> me.session_id)
       and (sl.blank_answer is null or sl.blank_answer <> me.answer)
     order by sl.blank_answer_embedding <=> (select answer_embedding from me) asc
     limit 5
  )
  select * from ranked order by random() limit 1;
$$;

-- verification:
--   select * from public.match_letter_for_session('<some session_id>'::uuid);
--   select * from public.match_letter_for_session_any('<some session_id>'::uuid);
