"""
match_poems RPC smoke test.
1) DB 무결성 (count, defense distribution, applicable ratio)
2) stimuli_rag에서 sample stimulus 가져와 → match_poems 호출
3) 같은 query를 (a) defense_filter 없이 (b) defense_filter 적용 비교
"""
import os
from pathlib import Path
from collections import Counter
from openai import OpenAI
from supabase import create_client
from dotenv import load_dotenv

REPO_ROOT = Path(__file__).resolve().parents[3]
load_dotenv(REPO_ROOT / '.env')

openai_client = OpenAI(api_key=os.getenv('OPENAI_API_KEY'))
sup = create_client(os.getenv('NEXT_PUBLIC_SUPABASE_URL'), os.getenv('SUPABASE_SECRET_KEY'))


def embed(text: str) -> list[float]:
    return openai_client.embeddings.create(
        model='text-embedding-3-large',
        input=text,
        dimensions=3072,
    ).data[0].embedding


def section(title):
    print('\n' + '=' * 72)
    print(f' {title}')
    print('=' * 72)


# 1) DB integrity ------------------------------------------------
section('1) poems_rag integrity')
cnt = sup.table('poems_rag').select('id', count='exact').limit(0).execute()
print(f'total rows: {cnt.count}')

# distribution (paginate)
defs, applicables = Counter(), Counter()
for page in range(0, 4):  # 4 * 1000 = enough
    r = (sup.table('poems_rag')
         .select('primary_defense, applicable')
         .range(page * 1000, page * 1000 + 999)
         .execute())
    rows = r.data or []
    if not rows:
        break
    for row in rows:
        defs[row['primary_defense']] += 1
        applicables[row['applicable']] += 1
    if len(rows) < 1000:
        break

print(f'applicable=true : {applicables[True]}')
print(f'applicable=false: {applicables[False]}')
print(f'top 5 defenses  :')
for d, n in defs.most_common(5):
    print(f'  {n:4d}  {d}')


# 2) sample stimulus ------------------------------------------------
section('2) pick a sample stimulus')
sti = (sup.table('stimuli_rag')
       .select('film, defense, stimulus')
       .eq('defense', 'Anticipation')
       .limit(1)
       .execute())
if not sti.data:
    print('no stimulus found')
    raise SystemExit(1)

stim = sti.data[0]
print(f"film    : {stim['film']}")
print(f"defense : {stim['defense']}")
print(f"stimulus:\n  | " + stim['stimulus'].replace('\n', '\n  | ')[:500])

q_emb = embed(stim['stimulus'])
print(f'\nquery embedding: dim={len(q_emb)}')


# 3) match_poems calls ------------------------------------------------
section('3a) match WITHOUT defense filter (top 5)')
r = sup.rpc('match_poems', {
    'query_embedding': q_emb,
    'match_threshold': 0.0,
    'match_count': 5,
}).execute()
for m in r.data:
    print(f"  sim={m['similarity']:.3f}  [{m['primary_defense']:25s}] "
          f"i={m['intensity']} ({m['stance']:11s})  {m['poem_name'][:45]}")

section(f"3b) match WITH defense_filter='{stim['defense']}' (top 5)")
r = sup.rpc('match_poems', {
    'query_embedding': q_emb,
    'match_threshold': 0.0,
    'match_count': 5,
    'defense_filter': stim['defense'],
}).execute()
for m in r.data:
    print(f"  sim={m['similarity']:.3f}  [{m['primary_defense']:25s}] "
          f"i={m['intensity']} ({m['stance']:11s})  {m['poem_name'][:45]}")
    print(f"    evidence: {(m.get('evidence') or '')[:120]}")

section(f"3c) match WITH defense + stance='confession' + min_intensity=4")
r = sup.rpc('match_poems', {
    'query_embedding': q_emb,
    'match_threshold': 0.0,
    'match_count': 5,
    'defense_filter': stim['defense'],
    'stance_filter': 'confession',
    'min_intensity': 4,
}).execute()
print(f'  {len(r.data)} hits')
for m in r.data:
    print(f"  sim={m['similarity']:.3f}  i={m['intensity']} ({m['stance']})  "
          f"{m['poem_name'][:45]}")

print('\nOK.')
