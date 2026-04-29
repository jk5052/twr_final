-- ============================================================
-- The White Room — blank_fill_templates: Korean → English reseed
--   10_endgame_schema.sql seeded 10 templates in Korean. The game
--   surface is now English-only, so overwrite each row's `template`
--   text in place (preserving ids, references in blank_fill_responses).
-- Run AFTER 10_endgame_schema.sql in Supabase SQL Editor.
-- ============================================================

update public.blank_fill_templates set template = 'I often ___.'                                 where id = 1;
update public.blank_fill_templates set template = 'I am someone who ___.'                        where id = 2;
update public.blank_fill_templates set template = 'I feel at ease when ___.'                     where id = 3;
update public.blank_fill_templates set template = 'I tend to stay where ___.'                    where id = 4;
update public.blank_fill_templates set template = 'I carry ___ with me.'                         where id = 5;
update public.blank_fill_templates set template = 'I leave ___ on.'                              where id = 6;
update public.blank_fill_templates set template = 'I left ___ behind.'                           where id = 7;
update public.blank_fill_templates set template = 'I keep going back to ___.'                    where id = 8;
update public.blank_fill_templates set template = 'I have buried ___.'                           where id = 9;
update public.blank_fill_templates set template = 'I look at myself in ___.'                     where id = 10;

-- verification:
--   select id, template from public.blank_fill_templates order by id;
