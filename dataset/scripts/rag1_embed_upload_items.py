"""
items_labeled.json (90 self-report items) → OpenAI 임베딩 → Supabase items_rag 업로드.
- input : dataset/processed/items_labeled.json
- output: items_rag rows  (resume: (source, item_id) 키 dedupe)
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

OPENAI_API_KEY = os.getenv('OPENAI_API_KEY')
EMBEDDING_MODEL = os.getenv('OPENAI_EMBEDDING_MODEL', 'text-embedding-3-large')
EMBEDDING_DIM = int(os.getenv('OPENAI_EMBEDDING_DIM', '3072'))
SUPABASE_URL = os.getenv('NEXT_PUBLIC_SUPABASE_URL')
SUPABASE_SECRET_KEY = os.getenv('SUPABASE_SECRET_KEY')

assert OPENAI_API_KEY, 'OPENAI_API_KEY missing'
assert SUPABASE_URL and SUPABASE_SECRET_KEY, 'Supabase env missing'

openai_client = OpenAI(api_key=OPENAI_API_KEY)
supabase = create_client(SUPABASE_URL, SUPABASE_SECRET_KEY)

DATA_PATH = REPO_ROOT / 'twr' / 'dataset' / 'processed' / 'items_labeled.json'
FAILED_PATH = REPO_ROOT / 'twr' / 'dataset' / 'processed' / 'items_upload_failed.json'

print(f'Model   : {EMBEDDING_MODEL} ({EMBEDDING_DIM}d)')
print(f'Supabase: {SUPABASE_URL}')


def embed_text(text: str, retries: int = 3) -> list[float]:
    for attempt in range(retries):
        try:
            r = openai_client.embeddings.create(
                model=EMBEDDING_MODEL,
                input=text,
                dimensions=EMBEDDING_DIM,
            )
            return r.data[0].embedding
        except Exception as e:
            if attempt == retries - 1:
                raise
            wait = 2 ** attempt
            print(f'  embed retry in {wait}s ({e})')
            time.sleep(wait)


def fetch_existing_keys() -> set[tuple[str, int]]:
    done: set[tuple[str, int]] = set()
    page = 0
    while True:
        rng_start = page * 1000
        r = (supabase.table('items_rag')
             .select('source, item_id')
             .range(rng_start, rng_start + 999)
             .execute())
        rows = r.data or []
        if not rows:
            break
        for row in rows:
            done.add((row['source'], int(row['item_id'])))
        if len(rows) < 1000:
            break
        page += 1
    return done


def main() -> None:
    items = json.loads(DATA_PATH.read_text(encoding='utf-8'))
    items = [i for i in items if '_error' not in i and i.get('primary_defense')]
    print(f'labeled items: {len(items)}')

    done = fetch_existing_keys()
    print(f'already uploaded: {len(done)}')
    todo = [i for i in items if (i['source'], int(i['item_id'])) not in done]
    print(f'to upload       : {len(todo)}\n')

    success = 0
    failed: list[dict] = []
    t0 = time.time()

    for idx, it in enumerate(todo):
        try:
            text = it.get('clean_text') or it['raw_text']
            embedding = embed_text(text)

            row = {
                'source'           : it['source'],
                'item_id'          : int(it['item_id']),
                'text'             : text,
                'raw_text'         : it.get('raw_text'),
                'primary_defense'  : it['primary_defense'],
                'secondary_defense': it.get('secondary_defense'),
                'reasoning'        : it.get('reasoning'),
                'embedding'        : embedding,
            }
            supabase.table('items_rag').insert(row).execute()
            success += 1

            if success % 10 == 1 or success == len(todo):
                rate = success / (time.time() - t0 + 1e-6)
                print(f'[{success:3d}/{len(todo)}] {it["source"]:11s} #{it["item_id"]:2d} '
                      f'→ {it["primary_defense"]:25s}  {rate:.1f}/s')
            time.sleep(0.05)

        except Exception as e:
            print(f'  FAIL [{idx}] {it["source"]} #{it["item_id"]}: {str(e)[:140]}')
            failed.append({
                'source': it['source'],
                'item_id': it['item_id'],
                'error': str(e)[:300],
            })
            FAILED_PATH.write_text(json.dumps(failed, indent=2, ensure_ascii=False))

    print(f'\n=== DONE ===')
    print(f'success: {success}')
    print(f'failed : {len(failed)}')
    print(f'time   : {(time.time()-t0):.1f}s')
    if failed:
        print(f'log    : {FAILED_PATH}')


if __name__ == '__main__':
    main()
