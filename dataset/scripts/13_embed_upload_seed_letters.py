"""
seed_letters.json → OpenAI embedding (blank_answer) → Supabase seed_letters.

- input : twr/dataset/processed/seed_letters.json
- output: rows in public.seed_letters  (source='seed', active=true)
- embed : text-embedding-3-large @ 3072 dim, stored as halfvec(3072) in
          blank_answer_embedding. Letter matching at runtime takes the
          player's blank_fill answer embedding and finds the closest seed
          letter within the same primary_defense (different blank_answer).
- resume: existing rows with same (primary_defense, blank_answer) are
          skipped — re-runs are idempotent.

Env (loaded from repo .env):
  OPENAI_API_KEY, NEXT_PUBLIC_SUPABASE_URL, SUPABASE_SECRET_KEY
"""
import json
import os
import time
from pathlib import Path
from openai import OpenAI
from supabase import create_client
from dotenv import load_dotenv

REPO_ROOT = Path(__file__).resolve().parents[3]
load_dotenv(REPO_ROOT / '.env')

OPENAI_API_KEY      = os.getenv('OPENAI_API_KEY')
EMBEDDING_MODEL     = os.getenv('OPENAI_EMBEDDING_MODEL', 'text-embedding-3-large')
EMBEDDING_DIM       = int(os.getenv('OPENAI_EMBEDDING_DIM', '3072'))
SUPABASE_URL        = os.getenv('NEXT_PUBLIC_SUPABASE_URL')
SUPABASE_SECRET_KEY = os.getenv('SUPABASE_SECRET_KEY')

assert OPENAI_API_KEY, 'OPENAI_API_KEY missing'
assert SUPABASE_URL and SUPABASE_SECRET_KEY, 'Supabase env missing'

oa  = OpenAI(api_key=OPENAI_API_KEY)
sup = create_client(SUPABASE_URL, SUPABASE_SECRET_KEY)

DATA_PATH = REPO_ROOT / 'twr' / 'dataset' / 'processed' / 'seed_letters.json'

print(f'Model   : {EMBEDDING_MODEL} ({EMBEDDING_DIM}d)')
print(f'Supabase: {SUPABASE_URL}')
print(f'Source  : {DATA_PATH}')


def embed_text(text: str, retries: int = 3) -> list[float]:
    for attempt in range(retries):
        try:
            r = oa.embeddings.create(model=EMBEDDING_MODEL, input=text, dimensions=EMBEDDING_DIM)
            return r.data[0].embedding
        except Exception as e:
            if attempt == retries - 1:
                raise
            wait = 2 ** attempt
            print(f'  embed retry in {wait}s ({type(e).__name__}: {str(e)[:120]})')
            time.sleep(wait)


def fetch_existing_keys() -> set[tuple[str, str]]:
    """Resume guard: skip seeds already uploaded with the same answer."""
    done: set[tuple[str, str]] = set()
    page = 0
    while True:
        rng_start = page * 1000
        r = (sup.table('seed_letters')
             .select('primary_defense, blank_answer')
             .eq('source', 'seed')
             .range(rng_start, rng_start + 999)
             .execute())
        rows = r.data or []
        if not rows:
            break
        for row in rows:
            done.add(((row.get('primary_defense') or '').strip(),
                      (row.get('blank_answer') or '').strip()))
        if len(rows) < 1000:
            break
        page += 1
    return done


def main() -> None:
    with DATA_PATH.open('r', encoding='utf-8') as f:
        seeds = json.load(f)
    if not isinstance(seeds, list) or not seeds:
        raise SystemExit(f'no seeds found in {DATA_PATH}')

    existing = fetch_existing_keys()
    print(f'\n{len(seeds)} seeds in file, {len(existing)} already in DB\n')

    inserted = 0
    skipped = 0
    failed = 0

    for s in seeds:
        defense = (s.get('primary_defense') or '').strip()
        answer  = (s.get('blank_answer') or '').strip()
        letter  = (s.get('letter_text') or '').strip()
        if not defense or not answer or not letter:
            print(f'  ! seed id={s.get("id")} missing required fields, skip')
            failed += 1
            continue

        key = (defense, answer)
        if key in existing:
            print(f'  - id={s.get("id")} already uploaded ({defense} / "{answer}"), skip')
            skipped += 1
            continue

        try:
            vec = embed_text(answer)
        except Exception as e:
            print(f'  ! id={s.get("id")} embed failed: {type(e).__name__}: {str(e)[:120]}')
            failed += 1
            continue

        if len(vec) != EMBEDDING_DIM:
            print(f'  ! id={s.get("id")} unexpected embedding dim={len(vec)}')
            failed += 1
            continue

        row = {
            'source':                   'seed',
            'author_pseudonym':         s.get('author_pseudonym'),
            'primary_defense':          defense,
            'blank_template_id':        s.get('blank_template_id'),
            'blank_answer':             answer,
            'blank_answer_embedding':   vec,
            'letter_text':              letter,
            'origin_session_id':        None,
            'active':                   True,
        }
        try:
            sup.table('seed_letters').insert(row).execute()
            print(f'  + id={s.get("id")} inserted ({defense} / "{answer}")')
            inserted += 1
            existing.add(key)
        except Exception as e:
            print(f'  ! id={s.get("id")} insert failed: {type(e).__name__}: {str(e)[:200]}')
            failed += 1

    print(f'\nDone. inserted={inserted}, skipped={skipped}, failed={failed}')


if __name__ == '__main__':
    main()
