"""
Ensemble RAG client — combines items_rag + lit_rag + choices_rag votes.

retrieve(query, *, weights, k_per_stream, filters) -> dict
  per_stream: top-K hits from each stream (raw RPC payload + similarity)
  votes     : per-defense vote totals + per-stream contribution
  distribution: 28-D probability (sum=1.0)
  top_defense, top_3, vaillant_profile, evidence

CLI:
  python3 ensemble_retrieve.py "query text" [--k 8] [--room 1] [--defense Repression]
"""
from __future__ import annotations
import argparse
import json
import os
import sys
from collections import defaultdict
from pathlib import Path
from dotenv import load_dotenv
from openai import OpenAI
from supabase import create_client

REPO_ROOT = Path(__file__).resolve().parents[3]
load_dotenv(REPO_ROOT / '.env')
sys.path.insert(0, str(Path(__file__).resolve().parent))
from _tagging_vocab import DEFENSES, VAILLANT_LEVEL  # noqa: E402

EMBEDDING_MODEL = os.getenv('OPENAI_EMBEDDING_MODEL', 'text-embedding-3-large')
EMBEDDING_DIM   = int(os.getenv('OPENAI_EMBEDDING_DIM', '3072'))
DEFAULT_WEIGHTS = {'items': 0.20, 'lit': 0.35, 'choices': 0.45}
DEFAULT_K       = 8
MODEL_VERSION   = 'ensemble@1.0'   # bump when vote algorithm / aggregate logic changes
SCHEMA_VERSION  = 'vocab@1.0'      # bump when _tagging_vocab DEFENSES/METAPHORS/OPERATIONS/MOTIFS change

oa  = OpenAI(api_key=os.getenv('OPENAI_API_KEY'))
sup = create_client(os.getenv('NEXT_PUBLIC_SUPABASE_URL'), os.getenv('SUPABASE_SECRET_KEY'))


def embed(text: str) -> list[float]:
    r = oa.embeddings.create(model=EMBEDDING_MODEL, input=[text], dimensions=EMBEDDING_DIM)
    return r.data[0].embedding


def _rpc(name: str, params: dict) -> list[dict]:
    return sup.rpc(name, params).execute().data or []


def fetch_streams(emb: list[float], k: int, filters: dict) -> dict[str, list[dict]]:
    base = {'query_embedding': emb, 'match_threshold': 0.0, 'match_count': k}
    items_p   = {**base, 'defense_filter': filters.get('defense')}
    lit_p     = {**base,
                 'defense_filter':  filters.get('defense'),
                 'vaillant_filter': filters.get('vaillant'),
                 'metaphor_filter': filters.get('metaphors'),
                 'operation_filter': filters.get('operations'),
                 'motif_filter':    filters.get('motifs'),
                 'empath_filter':   filters.get('empath')}
    choices_p = {**lit_p,
                 'room_filter': filters.get('room'),
                 'tag_filter':  filters.get('tag')}
    return {
        'items':   _rpc('match_items',   items_p),
        'lit':     _rpc('match_lit',     lit_p),
        'choices': _rpc('match_choices', choices_p),
    }


def _votes_from_hit(hit: dict, stream: str) -> dict[str, float]:
    """Return {defense: vote_unit} for a single hit (vote_unit ∈ [0,1] per hit, before stream/sim scaling)."""
    conf = hit.get('confidence')
    conf = 1.0 if conf is None else max(0.0, min(1.0, float(conf)))
    if stream == 'choices' and hit.get('defense_weights'):
        return {w['defense']: float(w['weight']) * conf for w in hit['defense_weights']}
    out = {hit['primary_defense']: 1.0 * conf}
    sec = hit.get('secondary_defense')
    if sec:
        out[sec] = out.get(sec, 0.0) + 0.5 * conf
    s = sum(out.values()) or 1.0
    return {k: v / s for k, v in out.items()}


def aggregate(streams: dict[str, list[dict]], weights: dict[str, float]) -> dict:
    votes_total: dict[str, float] = defaultdict(float)
    votes_breakdown: dict[str, dict[str, float]] = defaultdict(lambda: defaultdict(float))
    for stream, hits in streams.items():
        w_s = weights.get(stream, 0.0)
        for h in hits:
            sim = max(0.0, float(h.get('similarity') or 0.0))
            for d, v in _votes_from_hit(h, stream).items():
                if d not in DEFENSES:
                    continue
                contrib = v * sim * w_s
                votes_total[d] += contrib
                votes_breakdown[d][stream] += contrib

    total = sum(votes_total.values()) or 1.0
    distribution = {d: votes_total.get(d, 0.0) / total for d in DEFENSES}
    sorted_defs = sorted(DEFENSES, key=lambda d: -distribution[d])
    top_3 = [d for d in sorted_defs if distribution[d] > 0][:3]

    vaillant: dict[str, float] = defaultdict(float)
    for d, p in distribution.items():
        vaillant[VAILLANT_LEVEL.get(d, 'unknown')] += p

    # evidence: top hit per (top_defense, stream)
    evidence: dict[str, list[dict]] = {}
    for d in top_3:
        rows = []
        for stream, hits in streams.items():
            best = None
            for h in hits:
                contrib = _votes_from_hit(h, stream).get(d, 0.0)
                if contrib > 0 and (best is None or h['similarity'] > best['similarity']):
                    best = h
            if best:
                rows.append({
                    'stream':     stream,
                    'similarity': round(float(best['similarity']), 4),
                    'snippet':    (best.get('text') or best.get('quote')
                                   or f"{best.get('prompt','')} → {best.get('label','')}")[:200],
                    'source':     best.get('source'),
                    'primary':    best.get('primary_defense'),
                })
        evidence[d] = rows

    return {
        'votes': {d: round(votes_total[d], 4) for d in sorted_defs if votes_total[d] > 0},
        'votes_breakdown': {d: dict(v) for d, v in votes_breakdown.items() if sum(v.values()) > 0},
        'distribution': {d: round(distribution[d], 4) for d in DEFENSES},
        'top_defense': sorted_defs[0] if distribution[sorted_defs[0]] > 0 else None,
        'top_3': top_3,
        'vaillant_profile': {k: round(v, 4) for k, v in vaillant.items()},
        'evidence': evidence,
    }


def retrieve(query: str, *, weights: dict | None = None,
             k_per_stream: int = DEFAULT_K, filters: dict | None = None) -> dict:
    weights = weights or DEFAULT_WEIGHTS
    filters = filters or {}
    emb = embed(query)
    streams = fetch_streams(emb, k_per_stream, filters)
    agg = aggregate(streams, weights)
    return {
        'query': query,
        'model_version':  MODEL_VERSION,
        'schema_version': SCHEMA_VERSION,
        'config': {'embedding_model': EMBEDDING_MODEL, 'embedding_dim': EMBEDDING_DIM,
                   'weights': weights, 'k_per_stream': k_per_stream, 'filters': filters},
        'per_stream_counts': {k: len(v) for k, v in streams.items()},
        **agg,
    }


def main() -> None:
    ap = argparse.ArgumentParser()
    ap.add_argument('query')
    ap.add_argument('--k',        type=int, default=DEFAULT_K)
    ap.add_argument('--room',     type=int)
    ap.add_argument('--tag')
    ap.add_argument('--defense')
    ap.add_argument('--vaillant')
    ap.add_argument('--full',     action='store_true', help='print per_stream hits too')
    args = ap.parse_args()
    filters = {k: getattr(args, k) for k in ('room', 'tag', 'defense', 'vaillant') if getattr(args, k)}
    out = retrieve(args.query, k_per_stream=args.k, filters=filters)
    print(json.dumps(out, indent=2, ensure_ascii=False))


if __name__ == '__main__':
    main()
