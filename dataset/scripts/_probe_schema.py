"""
halfvec(3072) 스키마 적용 여부 빠른 확인.
1행 insert → 정리. 마이그레이션 안 됐으면 dim mismatch 에러.
"""
import os
from pathlib import Path
from dotenv import load_dotenv
from openai import OpenAI
from supabase import create_client

REPO_ROOT = Path(__file__).resolve().parents[3]
load_dotenv(REPO_ROOT / '.env')

openai_client = OpenAI(api_key=os.getenv('OPENAI_API_KEY'))
sup = create_client(
    os.getenv('NEXT_PUBLIC_SUPABASE_URL'),
    os.getenv('SUPABASE_SECRET_KEY'),
)

emb = openai_client.embeddings.create(
    model='text-embedding-3-large',
    input='probe',
    dimensions=3072,
).data[0].embedding

print(f'embedding dim: {len(emb)}')

try:
    sup.table('stimuli_rag').insert({
        'film': '__PROBE__',
        'defense': '__PROBE__',
        'stimulus': 'probe',
        'embedding': emb,
    }).execute()
    print('OK: halfvec(3072) accepted')
    sup.table('stimuli_rag').delete().eq('film', '__PROBE__').execute()
    print('cleanup done')
except Exception as e:
    print(f'FAIL: {e}')
