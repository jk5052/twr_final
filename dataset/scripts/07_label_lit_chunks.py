"""
Deep label lit chunks: defense + 3-axis (metaphor/operation/motif) + VAD +
applicable flag (Claude). Empath (194 lexical cats) computed locally in Python.

input  : twr/dataset/processed/lit_chunks_raw.json
output : twr/dataset/processed/lit_chunks_labeled.json
flags  : --limit N    label only first N pending chunks (sample run)
         --output P   override output path (e.g. _sample.json)

Resume: skips (source, chunk_id) already present in output.
"""
import argparse
import json
import os
import re
import sys
import time
from pathlib import Path
from anthropic import Anthropic
from dotenv import load_dotenv
from empath import Empath

REPO_ROOT = Path(__file__).resolve().parents[3]
load_dotenv(REPO_ROOT / '.env')
sys.path.insert(0, str(Path(__file__).resolve().parent))
from _tagging_vocab import (  # noqa: E402
    DEFENSES, VAILLANT_LEVEL, METAPHORS, OPERATIONS, MOTIFS,
    render_vocab_block, clamp_vad, empath_top_categories,
)

DATASET = REPO_ROOT / 'twr' / 'dataset'
CODEBOOK_PATH = DATASET / 'processed' / 'defense_codebook.json'
RAW_PATH      = DATASET / 'processed' / 'lit_chunks_raw.json'
OUT_PATH_DEF  = DATASET / 'processed' / 'lit_chunks_labeled.json'

client = Anthropic()
MODEL = 'claude-sonnet-4-5'
SAVE_EVERY = 5
EMPATH_TOP_K = 8


def render_codebook(cb: dict) -> str:
    parts = []
    for name, e in cb.items():
        if '_error' in e:
            continue
        parts.append(
            f'## {name} ({e.get("vaillant_level", "?")})\n'
            f'Definition: {e.get("definition", "")}\n'
            f'Linguistic: {"; ".join(e.get("linguistic_signals", [])[:8])}\n'
            f'Narrative : {"; ".join(e.get("narrative_patterns", [])[:6])}\n'
            f'Literary  : {e.get("literary_cues", "")}'
        )
    return '\n\n'.join(parts)


SYSTEM_TMPL = """You are a clinical psychologist + literary analyst labeling passages from defense-mechanism literature for a multi-stream RAG retrieval system. Output STRICT JSON, no prose, no markdown.

For each passage decide:
1. PRIMARY/SECONDARY DEFENSE — pick from the 28 codebook names below. Use anchor_defenses as a soft prior; override if the narrative actually instantiates another defense. Set secondary only if a second mechanism is clearly co-present.
2. APPLICABLE — set false ONLY when the passage is purely meta (citation list, scale items, table caption, dictionary-style definition with no narrative voice or case material). Set true for any passage that exemplifies, illustrates, theorizes about behavior, or quotes case material.
3. CONFIDENCE — your subjective certainty in primary_defense, [0,1].
4. REASONING — 1-3 sentences linking specific phrases in the passage to codebook signals (linguistic / narrative / literary). Cite codebook field names in your reasoning when relevant.
5. QUOTE — pick a verbatim sentence (≤280 chars) from the passage that best exemplifies the chosen primary_defense.
6. METAPHORS / OPERATIONS / MOTIFS — 0-3 / 0-3 / 0-5 labels each, picked ONLY from the closed vocabularies below. Anything you would add but is not in the vocab goes to *_novel arrays.
7. VAD — valence/arousal/dominance each in [0,1]; describes the affective stance the PASSAGE conveys (not the literal reader).

CLOSED VOCABULARIES:
{vocab}

CODEBOOK (28 defenses):
{codebook}
"""

USER_TMPL = """SOURCE: {source}  CHUNK: {chunk_id}  PAGES: {page_start}-{page_end}
ANCHOR_DEFENSES (soft prior, may be wrong): {anchors}

PASSAGE:
{text}

Output JSON exactly (no extra fields, no markdown):
{{
  "applicable": <true|false>,
  "primary_defense": "<exact codebook name>",
  "secondary_defense": <"<exact codebook name>"|null>,
  "confidence": <0.0-1.0>,
  "reasoning": "<1-3 sentences>",
  "quote": "<verbatim sentence from passage>",
  "metaphors":  [<0-3 from METAPHORS>],
  "operations": [<0-3 from OPERATIONS>],
  "motifs":     [<0-5 from MOTIFS>],
  "metaphors_novel":  [<any out-of-vocab metaphor labels>],
  "operations_novel": [<any out-of-vocab operation labels>],
  "motifs_novel":     [<any out-of-vocab motif labels>],
  "valence": <0.0-1.0>, "arousal": <0.0-1.0>, "dominance": <0.0-1.0>
}}"""


def build_system_blocks(cb: dict) -> list[dict]:
    text = SYSTEM_TMPL.format(vocab=render_vocab_block(), codebook=render_codebook(cb))
    return [{'type': 'text', 'text': text, 'cache_control': {'type': 'ephemeral'}}]


def label_one(system_blocks, chunk: dict) -> tuple[dict, dict]:
    user = USER_TMPL.format(
        source=chunk['source'], chunk_id=chunk['chunk_id'],
        page_start=chunk.get('page_start', '?'), page_end=chunk.get('page_end', '?'),
        anchors=', '.join(chunk['anchor_defenses']) or '(none)',
        text=chunk['text'],
    )
    resp = client.messages.create(
        model=MODEL, max_tokens=900, system=system_blocks,
        messages=[
            {'role': 'user', 'content': user},
            {'role': 'assistant', 'content': '{'},
        ],
    )
    raw = '{' + resp.content[0].text.strip()
    if raw.startswith('```'):
        raw = re.sub(r'^```(?:json)?\s*|\s*```$', '', raw, flags=re.MULTILINE)
    if not raw.rstrip().endswith('}'):
        raw = raw.rsplit(',', 1)[0] + '}'
    label = json.loads(raw)
    usage = {
        'input': resp.usage.input_tokens, 'output': resp.usage.output_tokens,
        'cache_read':  getattr(resp.usage, 'cache_read_input_tokens',  0) or 0,
        'cache_create': getattr(resp.usage, 'cache_creation_input_tokens', 0) or 0,
    }
    return label, usage


_VOCAB_BY_AXIS: dict[str, frozenset[str]] = {
    'metaphors':  frozenset(METAPHORS),
    'operations': frozenset(OPERATIONS),
    'motifs':     frozenset(MOTIFS),
}

# Vaillant-style names not in our 28-defense codebook → mapped equivalents.
_DEFENSE_ALIAS: dict[str, str] = {
    'delusional projection': 'Projection',
    'psychotic denial':      'Denial',
    'psychotic distortion':  'Denial',
}


def _canon_defense(v: str | None, defense_set: set[str]) -> tuple[str | None, str | None]:
    """Return (canonical, warning). Strips ' (level)' suffix and applies alias map."""
    if not v:
        return None, None
    if v in defense_set:
        return v, None
    stripped = re.sub(r'\s*\([^)]*\)\s*$', '', v).strip()
    if stripped in defense_set:
        return stripped, None
    aliased = _DEFENSE_ALIAS.get(stripped.lower())
    if aliased and aliased in defense_set:
        return aliased, f'aliased "{v}" → {aliased}'
    return None, f'"{v}" not in codebook → null'


def normalize(label: dict, defense_set: set[str]) -> dict:
    """Clamp/validate labels; coerce out-of-codebook defenses to null (after
    suffix-strip + alias map); auto-promote in-vocab *_novel items back to axis."""
    for fld in ('primary_defense', 'secondary_defense'):
        canon, warn = _canon_defense(label.get(fld), defense_set)
        label[fld] = canon
        if warn:
            label.setdefault('_warnings', []).append(f'{fld}: {warn}')
    label['vaillant_level'] = VAILLANT_LEVEL.get(label.get('primary_defense') or '', None)
    for k, vocab in _VOCAB_BY_AXIS.items():
        kn = f'{k}_novel'
        proposed = list(label.get(k, []))
        novel_in = list(label.get(kn, []))
        # split each list into in-vocab vs not
        proposed_in    = [x for x in proposed if x in vocab]
        proposed_novel = [x for x in proposed if x not in vocab]
        novel_promoted = [x for x in novel_in if x in vocab]
        novel_kept     = [x for x in novel_in if x not in vocab]
        label[k]  = sorted(set(proposed_in + novel_promoted))
        label[kn] = sorted(set(proposed_novel + novel_kept))
    label.update(clamp_vad({k: label.get(k, 0.5) for k in ('valence', 'arousal', 'dominance')}))
    label['confidence']  = max(0.0, min(1.0, float(label.get('confidence', 0.0))))
    label['applicable']  = bool(label.get('applicable', True))
    return label


def main() -> None:
    ap = argparse.ArgumentParser()
    ap.add_argument('--limit', type=int, default=0, help='label only first N pending (0=all)')
    ap.add_argument('--output', type=Path, default=OUT_PATH_DEF)
    args = ap.parse_args()

    cb = json.loads(CODEBOOK_PATH.read_text(encoding='utf-8'))
    chunks = json.loads(RAW_PATH.read_text(encoding='utf-8'))
    defense_set = set(DEFENSES)
    print(f'codebook: {len(cb)}  chunks: {len(chunks)}  vocab: {len(cb)} defs / 10 / 10 / 41')

    existing: list[dict] = []
    if args.output.exists():
        raw_existing = json.loads(args.output.read_text(encoding='utf-8'))
        # Keep only entries with a non-null primary_defense; the rest (errors
        # + null-primary OOV coercions) are re-queued for retry under the
        # updated normalize() rules.
        existing = [r for r in raw_existing if r.get('primary_defense')]
        dropped = len(raw_existing) - len(existing)
        print(f'resume  : {len(existing)} done' + (f' (re-queueing {dropped} error/null rows for retry)' if dropped else ''))
    done_keys = {(r['source'], r['chunk_id']) for r in existing}

    system_blocks = build_system_blocks(cb)
    lex = Empath()
    results = list(existing)
    total = {'input': 0, 'output': 0, 'cache_read': 0, 'cache_create': 0}
    t0 = time.time()
    new_count = 0

    pending = [c for c in chunks if (c['source'], c['chunk_id']) not in done_keys]
    if args.limit > 0:
        pending = pending[:args.limit]
    print(f'pending : {len(pending)}\n')

    for c in pending:
        try:
            label, usage = label_one(system_blocks, c)
            for k in total: total[k] += usage[k]
            label = normalize(label, defense_set)
            empath_scores = lex.analyze(c['text'], normalize=True) or {}
            label['empath'] = {k: v for k, v in empath_scores.items() if v > 0}
            label['empath_top'] = empath_top_categories(empath_scores, k=EMPATH_TOP_K)
            results.append({**c, **label})
            new_count += 1
            mark = '✓' if label['applicable'] else '·'
            pd = label.get('primary_defense') or '?'
            conf = label.get('confidence')
            conf_s = f'{conf:.2f}' if isinstance(conf, (int, float)) else 'n/a'
            print(f"[{len(results):4d}/{len(chunks)}] {mark} {c['source'][:30]:30s} #{c['chunk_id']:4d} → "
                  f"{pd:27s} (conf {conf_s})")
        except Exception as e:
            results.append({**c, '_error': str(e)[:300]})
            print(f"  FAIL {c['source']} #{c['chunk_id']}: {str(e)[:120]}")
        if new_count % SAVE_EVERY == 0:
            args.output.write_text(json.dumps(results, indent=2, ensure_ascii=False), encoding='utf-8')

    args.output.write_text(json.dumps(results, indent=2, ensure_ascii=False), encoding='utf-8')
    cost = (total['input']*3 + total['cache_create']*3.75
            + total['cache_read']*0.30 + total['output']*15) / 1_000_000
    print(f'\n=== DONE === new:{new_count} cost:${cost:.3f} time:{(time.time()-t0)/60:.1f}m')
    print(f'tokens — in:{total["input"]:,}  cache_w:{total["cache_create"]:,}  '
          f'cache_r:{total["cache_read"]:,}  out:{total["output"]:,}')
    print(f'saved: {args.output}')


if __name__ == '__main__':
    main()
