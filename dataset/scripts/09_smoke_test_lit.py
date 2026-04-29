"""
lit_rag smoke test — 가상 narrative/choice query를 던져 top-K passage 확인.
match_lit RPC + GIN array filters (metaphor/operation/motif/empath) 동작 검증.
"""
import os
from pathlib import Path
from openai import OpenAI
from supabase import create_client
from dotenv import load_dotenv

REPO_ROOT = Path(__file__).resolve().parents[3]
load_dotenv(REPO_ROOT / '.env')

EMBEDDING_MODEL     = os.getenv('OPENAI_EMBEDDING_MODEL', 'text-embedding-3-large')
EMBEDDING_DIM       = int(os.getenv('OPENAI_EMBEDDING_DIM', '3072'))
SUPABASE_URL        = os.getenv('NEXT_PUBLIC_SUPABASE_URL')
SUPABASE_SECRET_KEY = os.getenv('SUPABASE_SECRET_KEY')

oa  = OpenAI(api_key=os.getenv('OPENAI_API_KEY'))
sup = create_client(SUPABASE_URL, SUPABASE_SECRET_KEY)

QUERIES = [
    {
        'label':  'projection — externalising blame',
        'text':   "It's not that I'm angry. They are. I can see the rage in their eyes whenever they look at me.",
        'expected': {'Projection', 'Projective Identification'},
    },
    {
        'label':  'splitting / devaluation reversal',
        'text':   "She used to be the only one who understood me. Now I see she was hollow all along — nothing in her was real.",
        'expected': {'Splitting', 'Devaluation', 'Idealization'},
    },
    {
        'label':  'intellectualised distance',
        'text':   "If you analyse the variables objectively, the loss was statistically expected. Emotion clouds the data.",
        'expected': {'Intellectualization', 'Isolation of Affect', 'Rationalization'},
    },
    {
        'label':  'reaction formation',
        'text':   "I bring my rival flowers every morning. I smile so wide it hurts. I would never wish him harm.",
        'expected': {'Reaction Formation', 'Undoing'},
    },
    {
        'label':  'sublimation — transformed drive',
        'text':   "All that fury — I poured it into the canvas. The painting is monstrous and beautiful and finally mine.",
        'expected': {'Sublimation', 'Humor', 'Anticipation'},
    },
    {
        'label':  'apathetic withdrawal / dissociation',
        'text':   "I went thin. I sat in the corner and watched the room from far away as if it had nothing to do with me.",
        'expected': {'Apathetic Withdrawal', 'Dissociation', 'Denial', 'Suppression'},
    },
]


def embed(text: str) -> list[float]:
    r = oa.embeddings.create(model=EMBEDDING_MODEL, input=text, dimensions=EMBEDDING_DIM)
    return r.data[0].embedding


def vote(rows: list[dict]) -> list[tuple[str, float]]:
    """primary +1.0×sim, secondary +0.5×sim, weighted by confidence."""
    scores: dict[str, float] = {}
    for r in rows:
        sim  = float(r['similarity'])
        conf = float(r.get('confidence') or 0.7)
        w    = sim * conf
        p = r.get('primary_defense')
        s = r.get('secondary_defense')
        if p: scores[p] = scores.get(p, 0.0) + w
        if s: scores[s] = scores.get(s, 0.0) + w * 0.5
    return sorted(scores.items(), key=lambda x: -x[1])


def main() -> None:
    cnt = sup.table('lit_rag').select('id', count='exact').limit(0).execute()
    print(f'lit_rag rows: {cnt.count}\n')
    if not cnt.count:
        print('table empty — run 08_embed_upload_lit.py first.')
        return

    hits = 0
    for q in QUERIES:
        emb = embed(q['text'])
        r = sup.rpc('match_lit', {
            'query_embedding': emb,
            'match_threshold': 0.0,
            'match_count': 6,
        }).execute()
        rows = r.data or []
        ranked = vote(rows)
        top = ranked[0][0] if ranked else None

        ok = top in q['expected']
        hits += int(ok)
        mark = '✓' if ok else '✗'
        print(f'{mark} [{q["label"]}]  "{q["text"][:70]}..."')
        print(f'   top vote: {top}   expected ∈ {sorted(q["expected"])}')
        print(f'   ranked: ' + ', '.join(f'{d}({s:.2f})' for d, s in ranked[:5]))
        print(f'   passages:')
        for it in rows[:5]:
            tags = []
            if it.get('metaphors'):  tags.append('M:' + ','.join(it['metaphors'][:2]))
            if it.get('motifs'):     tags.append('C:' + ','.join(it['motifs'][:2]))
            if it.get('empath_top'): tags.append('E:' + ','.join(it['empath_top'][:2]))
            print(f'     sim={it["similarity"]:.3f}  {it["source"][:22]:22s} #{it["chunk_id"]:3d}  '
                  f'→ {it["primary_defense"]}  [{" | ".join(tags)}]')
            print(f'                "{(it.get("quote") or it["text"])[:110]}"')
        print()

    print(f'=== TOP-K vote SUMMARY ===  expected-hits {hits}/{len(QUERIES)}\n')

    # GIN filter sanity check — pull anything with motif='mirror'
    print('=== GIN filter probe (motif="mirror") ===')
    emb = embed("a fragmented self looking back at me from the glass")
    r = sup.rpc('match_lit', {
        'query_embedding': emb,
        'match_threshold': 0.0,
        'match_count': 5,
        'motif_filter': ['mirror'],
    }).execute()
    for it in (r.data or []):
        print(f'  sim={it["similarity"]:.3f}  {it["source"][:22]:22s} #{it["chunk_id"]:3d}  '
              f'→ {it["primary_defense"]}  motifs={it.get("motifs")}')
    if not r.data:
        print('  (no rows matched motif=mirror — vocabulary may need expansion)')

    print('\n=== empath filter probe (empath_top contains "shame") ===')
    r = sup.rpc('match_lit', {
        'query_embedding': emb,
        'match_threshold': 0.0,
        'match_count': 5,
        'empath_filter': ['shame'],
    }).execute()
    for it in (r.data or []):
        print(f'  sim={it["similarity"]:.3f}  {it["source"][:22]:22s} #{it["chunk_id"]:3d}  '
              f'→ {it["primary_defense"]}  empath_top={it.get("empath_top")}')
    if not r.data:
        print('  (no rows matched empath=shame)')


if __name__ == '__main__':
    main()
