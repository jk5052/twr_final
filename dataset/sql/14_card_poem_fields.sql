-- ============================================================
-- The White Room — talisman poem snapshot
--   pin the matched poem (title + author) onto generated_cards
--   so the second card page is reproducible without re-querying
--   poems_rag. card_poem already exists for the content.
-- Run AFTER 13_letter_replies_and_share.sql.
-- ============================================================

alter table public.generated_cards
  add column if not exists card_poem_title  text,
  add column if not exists card_poem_author text;

-- verification:
--   select column_name, data_type from information_schema.columns
--    where table_name = 'generated_cards'
--      and column_name in ('card_poem','card_poem_title','card_poem_author');
