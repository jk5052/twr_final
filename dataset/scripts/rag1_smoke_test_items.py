"""
items_rag smoke test — 가상 player response 4종을 query로 던져 top-5 items 확인.
RAG1 Method A (item retrieval) 동작 검증.
"""
import os
from pathlib import Path
from collections import Counter
from openai import OpenAI
from supabase import create_client
from dotenv import load_dotenv

REPO_ROOT = Path(__file__).resolve().parents[3]
load_dotenv(REPO_ROOT / '.env')

EMBEDDING_MODEL = os.getenv('OPENAI_EMBEDDING_MODEL', 'text-embedding-3-large')
EMBEDDING_DIM = int(os.getenv('OPENAI_EMBEDDING_DIM', '3072'))
SUPABASE_URL = os.getenv('NEXT_PUBLIC_SUPABASE_URL')
SUPABASE_SECRET_KEY = os.getenv('SUPABASE_SECRET_KEY')

openai_client = OpenAI(api_key=os.getenv('OPENAI_API_KEY'))
supabase = create_client(SUPABASE_URL, SUPABASE_SECRET_KEY)

# expected_defense 는 의도된 1차 방어기제(검증용 ground truth)
QUERIES = [
    {
        'label': 'avoidant withdrawal in conflict',
        'text': "I'd rather not look. There's nothing to see anyway. I'll just go quiet until it passes.",
        'expected': {'Apathetic Withdrawal', 'Denial', 'Suppression', 'Dissociation'},
    },
    {
        'label': 'hyper-rational distancing',
        'text': "Statistically speaking, this kind of outcome is well within expected variance. There's no point in getting emotional.",
        'expected': {'Intellectualization', 'Isolation of Affect', 'Rationalization'},
    },
    {
        'label': 'preemptive worry / planning',
        'text': "I keep imagining how it might go wrong tomorrow so I can have a plan ready when it does.",
        'expected': {'Anticipation', 'Self-Observation'},
    },
    {
        'label': 'all-or-nothing reversal',
        'text': "Yesterday I thought she was the best person I knew. Now I see she's poison through and through.",
        'expected': {'Splitting', 'Devaluation', 'Idealization'},
    },
]


def embed(text: str) -> list[float]:
    r = openai_client.embeddings.create(model=EMBEDDING_MODEL, input=text, dimensions=EMBEDDING_DIM)
    return r.data[0].embedding


def vote(rows: list[dict]) -> list[tuple[str, float]]:
    """Method A scoring — defense별 similarity 합산."""
    scores: dict[str, float] = {}
    for r in rows:
        sim = float(r['similarity'])
        primary = r['primary_defense']
        secondary = r.get('secondary_defense')
        scores[primary] = scores.get(primary, 0.0) + sim
        if secondary:
            scores[secondary] = scores.get(secondary, 0.0) + sim * 0.5
    return sorted(scores.items(), key=lambda x: -x[1])


def main() -> None:
    # 카운트 확인
    cnt = supabase.table('items_rag').select('id', count='exact').execute()
    print(f'items_rag rows: {cnt.count}\n')
    if not cnt.count:
        print('table empty — run rag1_embed_upload_items.py first.')
        return

    hits = 0
    for q in QUERIES:
        emb = embed(q['text'])
        r = supabase.rpc('match_items', {
            'query_embedding': emb,
            'match_threshold': 0.0,
            'match_count': 5,
        }).execute()
        rows = r.data or []
        ranked = vote(rows)
        top = ranked[0][0] if ranked else None

        ok = top in q['expected']
        hits += int(ok)
        mark = '✓' if ok else '✗'
        print(f'{mark} [{q["label"]}]  query: "{q["text"][:60]}..."')
        print(f'   top defense (vote): {top}   expected ∈ {q["expected"]}')
        print(f'   ranked top-5:')
        for d, s in ranked[:5]:
            print(f'     {s:.3f}  {d}')
        print(f'   matched items:')
        for it in rows:
            print(f'     sim={it["similarity"]:.3f}  {it["source"]} #{it["item_id"]}  → {it["primary_defense"]}')
            print(f'                "{it["text"][:90]}"')
        print()

    print(f'=== SUMMARY ===  expected-hits {hits}/{len(QUERIES)}')


if __name__ == '__main__':
    main()
