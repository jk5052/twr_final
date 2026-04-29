"""
421편 자극 → OpenAI 임베딩 → Supabase 업로드
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

assert OPENAI_API_KEY, 'OPENAI_API_KEY missing in .env'
assert SUPABASE_URL, 'NEXT_PUBLIC_SUPABASE_URL missing in .env'
assert SUPABASE_SECRET_KEY, 'SUPABASE_SECRET_KEY missing in .env'

openai_client = OpenAI(api_key=OPENAI_API_KEY)
supabase = create_client(SUPABASE_URL, SUPABASE_SECRET_KEY)

print(f'Model: {EMBEDDING_MODEL} ({EMBEDDING_DIM}d)')
print(f'Supabase: {SUPABASE_URL}\n')


def embed_text(text, retries=3):
    """텍스트 → EMBEDDING_DIM 차원 벡터"""
    for attempt in range(retries):
        try:
            response = openai_client.embeddings.create(
                model=EMBEDDING_MODEL,
                input=text,
                dimensions=EMBEDDING_DIM,
            )
            return response.data[0].embedding
        except Exception as e:
            if attempt == retries - 1:
                raise
            wait = 2 ** attempt
            print(f'  embed retry in {wait}s ({e})')
            time.sleep(wait)


# 데이터 로드
SCRIPT_DIR = Path(__file__).resolve().parent
DATA_PATH = SCRIPT_DIR.parent / 'processed' / 'stimuli_cleaned.json'
FAILED_PATH = SCRIPT_DIR.parent / 'processed' / 'upload_failed.json'

with open(DATA_PATH, 'r', encoding='utf-8') as f:
    stimuli = json.load(f)

# 이미 업로드된 (film, defense) skip
existing = supabase.table('stimuli_rag').select('film, defense').execute()
done = {(r['film'], r['defense']) for r in (existing.data or [])}
print(f'이미 업로드됨: {len(done)}편')
print(f'총 {len(stimuli)}편 중 {len(stimuli) - len(done)}편 처리 예정\n')

success = 0
skipped = 0
failed = []

for i, item in enumerate(stimuli):
    key = (item['film'], item['defense'])
    if key in done:
        skipped += 1
        continue

    try:
        embedding = embed_text(item['stimulus'])

        supabase.table('stimuli_rag').insert({
            'film': item['film'],
            'defense': item['defense'],
            'stimulus': item['stimulus'],
            'evidence_from_plot': item.get('evidence_from_plot', ''),
            'confidence': item.get('confidence', 0),
            'embedding': embedding,
        }).execute()

        success += 1
        if (success + skipped) % 20 == 0:
            print(f'[{i+1}/{len(stimuli)}] 누적 성공 {success}, skip {skipped}')

        time.sleep(0.1)

    except Exception as e:
        print(f'[{i+1}] 실패: {item["film"]} - {item["defense"]}: {e}')
        failed.append({'film': item['film'], 'defense': item['defense'], 'error': str(e)})

print('\n=====')
print(f'성공: {success}')
print(f'스킵: {skipped}')
print(f'실패: {len(failed)}')

if failed:
    with open(FAILED_PATH, 'w', encoding='utf-8') as f:
        json.dump(failed, f, indent=2, ensure_ascii=False)
    print(f'실패 로그: {FAILED_PATH}')