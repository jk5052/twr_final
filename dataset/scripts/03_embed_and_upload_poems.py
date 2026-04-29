"""
2873편 태깅된 시 → OpenAI 임베딩 → Supabase poems_rag 업로드.
- input : dataset/processed/poems_tagged.json
- output: poems_rag rows (resume 가능: (poem_name, author) 키 dedupe)
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

DATA_PATH = REPO_ROOT / 'twr' / 'dataset' / 'processed' / 'poems_tagged.json'
FAILED_PATH = REPO_ROOT / 'twr' / 'dataset' / 'processed' / 'poems_upload_failed.json'

print(f'Model   : {EMBEDDING_MODEL} ({EMBEDDING_DIM}d)')
print(f'Supabase: {SUPABASE_URL}')


def embed_text(text, retries=3):
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


def fetch_existing_keys():
    """이미 업로드된 (poem_name, author) 페이지네이션 수집."""
    done = set()
    page = 0
    while True:
        rng_start = page * 1000
        r = (supabase.table('poems_rag')
             .select('poem_name, author')
             .range(rng_start, rng_start + 999)
             .execute())
        rows = r.data or []
        if not rows:
            break
        for row in rows:
            done.add((row['poem_name'], row.get('author') or 'unknown'))
        if len(rows) < 1000:
            break
        page += 1
    return done


def main():
    poems = json.loads(DATA_PATH.read_text(encoding='utf-8'))
    # tag-bearing entries만 (skip _error)
    poems = [p for p in poems if '_error' not in p]
    print(f'tagged poems: {len(poems)}')

    done = fetch_existing_keys()
    print(f'already uploaded: {len(done)}')
    todo = [p for p in poems if (p['poem_name'], p.get('author') or 'unknown') not in done]
    print(f'to upload       : {len(todo)}\n')

    success = 0
    failed = []
    t0 = time.time()

    for i, p in enumerate(todo):
        try:
            # embed: title + author + content (semantic context)
            text = f"{p['poem_name']}\n{p.get('author','unknown')}\n\n{p['content']}"
            embedding = embed_text(text)

            row = {
                'poem_name'        : p['poem_name'],
                'author'           : p.get('author') or 'unknown',
                'content'          : p['content'],
                'word_count'       : p.get('word_count') or 0,
                'primary_defense'  : p.get('primary_defense'),
                'secondary_defense': p.get('secondary_defense'),
                'intensity'        : p.get('intensity'),
                'stance'           : p.get('stance'),
                'evidence'         : p.get('evidence'),
                'confidence'       : p.get('confidence'),
                'applicable'       : bool(p.get('applicable', True)),
                'embedding'        : embedding,
            }
            supabase.table('poems_rag').insert(row).execute()
            success += 1

            if success % 50 == 1 or success == len(todo):
                rate = success / (time.time() - t0 + 1e-6)
                eta_m = (len(todo) - success) / rate / 60 if rate > 0 else 0
                print(f'[{success:4d}/{len(todo)}] {p["poem_name"][:40]:40s} '
                      f'{rate:.1f}/s  ETA={eta_m:.1f}m')
            time.sleep(0.05)

        except Exception as e:
            print(f'  FAIL [{i}] {p["poem_name"][:40]}: {str(e)[:140]}')
            failed.append({
                'poem_name': p['poem_name'],
                'author': p.get('author'),
                'error': str(e)[:300],
            })
            FAILED_PATH.write_text(json.dumps(failed, indent=2, ensure_ascii=False))

    print(f'\n=== DONE ===')
    print(f'success: {success}')
    print(f'failed : {len(failed)}')
    print(f'time   : {(time.time()-t0)/60:.1f}m')
    if failed:
        print(f'log    : {FAILED_PATH}')


if __name__ == '__main__':
    main()
