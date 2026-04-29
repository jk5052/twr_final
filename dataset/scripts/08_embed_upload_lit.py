"""
lit_chunks_labeled.json (clinical-lit chunks) → OpenAI 임베딩 → Supabase lit_rag 업로드.
- input : twr/dataset/processed/lit_chunks_labeled.json
- output: lit_rag rows  (resume: (source, chunk_id) 키 dedupe)
- flags : --limit N      first N pending only
          --batch  N      embedding batch size (default 32)
          --skip-error    skip rows with _error / no primary_defense (default true)
"""
import argparse
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

DATA_PATH   = REPO_ROOT / 'twr' / 'dataset' / 'processed' / 'lit_chunks_labeled.json'
FAILED_PATH = REPO_ROOT / 'twr' / 'dataset' / 'processed' / 'lit_upload_failed.json'

print(f'Model   : {EMBEDDING_MODEL} ({EMBEDDING_DIM}d)')
print(f'Supabase: {SUPABASE_URL}')


def embed_batch(texts: list[str], retries: int = 3) -> list[list[float]]:
    for attempt in range(retries):
        try:
            r = oa.embeddings.create(model=EMBEDDING_MODEL, input=texts, dimensions=EMBEDDING_DIM)
            return [d.embedding for d in r.data]
        except Exception as e:
            if attempt == retries - 1:
                raise
            wait = 2 ** attempt
            print(f'  embed retry in {wait}s ({type(e).__name__}: {str(e)[:120]})')
            time.sleep(wait)


def fetch_existing_keys() -> set[tuple[str, int]]:
    done: set[tuple[str, int]] = set()
    page = 0
    while True:
        rng_start = page * 1000
        r = (sup.table('lit_rag')
             .select('source, chunk_id')
             .range(rng_start, rng_start + 999)
             .execute())
        rows = r.data or []
        if not rows:
            break
        for row in rows:
            done.add((row['source'], int(row['chunk_id'])))
        if len(rows) < 1000:
            break
        page += 1
    return done


def to_row(c: dict, embedding: list[float]) -> dict:
    """Project labeled chunk to lit_rag schema columns."""
    return {
        'source'           : c['source'],
        'chunk_id'         : int(c['chunk_id']),
        'text'             : c['text'],
        'page_start'       : c.get('page_start'),
        'page_end'         : c.get('page_end'),
        'primary_defense'  : c['primary_defense'],
        'secondary_defense': c.get('secondary_defense'),
        'vaillant_level'   : c.get('vaillant_level'),
        'reasoning'        : c.get('reasoning'),
        'quote'            : c.get('quote'),
        'confidence'       : c.get('confidence'),
        'applicable'       : bool(c.get('applicable', True)),
        'metaphors'        : c.get('metaphors',  []) or [],
        'operations'       : c.get('operations', []) or [],
        'motifs'           : c.get('motifs',     []) or [],
        'metaphors_novel'  : c.get('metaphors_novel',  []) or [],
        'operations_novel' : c.get('operations_novel', []) or [],
        'motifs_novel'     : c.get('motifs_novel',     []) or [],
        'valence'          : c.get('valence'),
        'arousal'          : c.get('arousal'),
        'dominance'        : c.get('dominance'),
        'empath'           : c.get('empath'),
        'empath_top'       : c.get('empath_top', []) or [],
        'embedding'        : embedding,
    }


def main() -> None:
    ap = argparse.ArgumentParser()
    ap.add_argument('--limit', type=int, default=0, help='first N pending only (0=all)')
    ap.add_argument('--batch', type=int, default=32, help='embedding batch size')
    args = ap.parse_args()

    rows_in = json.loads(DATA_PATH.read_text(encoding='utf-8'))
    usable  = [r for r in rows_in if '_error' not in r and r.get('primary_defense')]
    skipped = len(rows_in) - len(usable)
    print(f'labeled  : {len(rows_in)}  usable: {len(usable)}  skipped: {skipped}')

    done = fetch_existing_keys()
    print(f'already  : {len(done)}')
    todo = [r for r in usable if (r['source'], int(r['chunk_id'])) not in done]
    if args.limit > 0:
        todo = todo[:args.limit]
    print(f'to upload: {len(todo)}\n')

    success = 0
    failed: list[dict] = []
    t0 = time.time()

    for bstart in range(0, len(todo), args.batch):
        batch = todo[bstart:bstart + args.batch]
        try:
            embs = embed_batch([c['text'] for c in batch])
            payload = [to_row(c, e) for c, e in zip(batch, embs)]
            sup.table('lit_rag').upsert(payload, on_conflict='source,chunk_id').execute()
            success += len(batch)
            rate = success / (time.time() - t0 + 1e-6)
            head = batch[0]
            print(f'[{success:4d}/{len(todo)}] {head["source"][:25]:25s} #{head["chunk_id"]:4d}+{len(batch)-1} '
                  f'→ {head["primary_defense"]:25s}  {rate:.1f}/s')
        except Exception as e:
            for c in batch:
                failed.append({'source': c['source'], 'chunk_id': c['chunk_id'], 'error': str(e)[:300]})
            FAILED_PATH.write_text(json.dumps(failed, indent=2, ensure_ascii=False))
            print(f'  FAIL batch {bstart}: {type(e).__name__}: {str(e)[:140]}')

    print(f'\n=== DONE ===  success:{success}  failed:{len(failed)}  time:{(time.time()-t0):.1f}s')
    if failed:
        print(f'log: {FAILED_PATH}')


if __name__ == '__main__':
    main()
