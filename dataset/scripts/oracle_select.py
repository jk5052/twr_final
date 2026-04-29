"""
Oracle stimulus picker — given a card's top_3 defenses, return one stimulus
row from stimuli_rag.

Policy
------
1. Pool = stimuli_rag rows where defense = top_3[0].
2. If |pool| >= MIN_POOL (default 3): uniform random pick from pool.
3. Else fall back to top_3[1], then top_3[2]; if all under MIN_POOL, take
   the largest pool available (still uniform random within).
4. If top_3 is empty, return None.

Usage (module)
--------------
    from oracle_select import pick_oracle
    res = pick_oracle(['Repression', 'Isolation of Affect', 'Denial'])
    # → {stimulus_id, defense_used, fallback_level, pool_size,
    #    film, stimulus, evidence_from_plot}

CLI
---
    python3 oracle_select.py "Repression" "Isolation of Affect" "Denial"
"""
from __future__ import annotations
import argparse
import json
import os
import random
import sys
from pathlib import Path
from dotenv import load_dotenv
from supabase import create_client

REPO_ROOT = Path(__file__).resolve().parents[3]
load_dotenv(REPO_ROOT / '.env')

MIN_POOL = 3

_sup = None
def _client():
    global _sup
    if _sup is None:
        _sup = create_client(os.getenv('NEXT_PUBLIC_SUPABASE_URL'),
                             os.getenv('SUPABASE_SECRET_KEY'))
    return _sup


def _fetch_pool(defense: str) -> list[dict]:
    r = (_client().table('stimuli_rag')
         .select('id, film, defense, stimulus, evidence_from_plot, confidence')
         .eq('defense', defense)
         .execute())
    return r.data or []


def pick_oracle(top_3: list[str], *,
                min_pool: int = MIN_POOL,
                seed: int | None = None) -> dict | None:
    """Return one randomly-picked stimulus matching the player's top defense.

    fallback_level: 0 → top_1 used, 1 → top_2 used, 2 → top_3 used, -1 → all
    pools were under min_pool and we picked from the largest available.
    """
    if not top_3:
        return None
    rng = random.Random(seed)
    tried: list[tuple[int, str, list[dict]]] = []
    for level, defense in enumerate(top_3):
        if not defense:
            continue
        pool = _fetch_pool(defense)
        tried.append((level, defense, pool))
        if len(pool) >= min_pool:
            pick = rng.choice(pool)
            return {
                **pick,
                'defense_used':   defense,
                'fallback_level': level,
                'pool_size':      len(pool),
            }
    # all pools under min_pool — take largest non-empty
    tried = [t for t in tried if t[2]]
    if not tried:
        return None
    level, defense, pool = max(tried, key=lambda t: len(t[2]))
    pick = rng.choice(pool)
    return {
        **pick,
        'defense_used':   defense,
        'fallback_level': -1,
        'pool_size':      len(pool),
    }


def attach_to_card(session_id: str, *, top_3: list[str] | None = None,
                   seed: int | None = None) -> dict | None:
    """Pick an oracle and write it to cards.oracle_stimulus_id for the session."""
    sup = _client()
    if top_3 is None:
        row = (sup.table('cards').select('top_3')
               .eq('session_id', session_id).single().execute()).data
        top_3 = row['top_3'] if row else []
    pick = pick_oracle(top_3, seed=seed)
    if not pick:
        return None
    sup.table('cards').update({'oracle_stimulus_id': pick['id']}) \
        .eq('session_id', session_id).execute()
    return pick


def main() -> None:
    ap = argparse.ArgumentParser()
    ap.add_argument('top_3', nargs='+', help='top_3 defense names in order')
    ap.add_argument('--seed', type=int)
    ap.add_argument('--min-pool', type=int, default=MIN_POOL)
    args = ap.parse_args()
    res = pick_oracle(args.top_3, min_pool=args.min_pool, seed=args.seed)
    if not res:
        print('no stimulus found for', args.top_3)
        return
    print(json.dumps({k: v for k, v in res.items() if k != 'embedding'},
                     indent=2, ensure_ascii=False))


if __name__ == '__main__':
    main()
