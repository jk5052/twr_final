"""
Deep-label player choices (Stream B): defense-weighted candidates + 3-axis
(metaphor/operation/motif) + VAD + applicable. Empath computed locally.

input  : twr/dataset/processed/choices_raw.json
output : twr/dataset/processed/choices_labeled.json
flags  : --limit N    label only first N pending
         --output P   override output path

Resume: skips entries that already carry a non-null primary_defense.
"""
import argparse
import json
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
RAW_PATH      = DATASET / 'processed' / 'choices_raw.json'
OUT_PATH_DEF  = DATASET / 'processed' / 'choices_labeled.json'

client = Anthropic()
MODEL = 'claude-sonnet-4-5'
SAVE_EVERY = 10
EMPATH_TOP_K = 8

TAG_HINT = {
    'AV': 'avoidant — minimization, withdrawal, refusal, going still',
    'EX': 'exploratory — approach, curiosity, action, contact',
    'CG': 'cognitive — analytic, distancing-by-thought, accounting',
    'SP': 'suspicious / paranoid — projection, attribution, watchfulness',
    'AD': 'autobiographical / depth — memory, identification, longing',
}


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


SYSTEM_TMPL = """You are a clinical psychologist labeling discrete in-game player choices for a multi-stream RAG retrieval system. Each item is a (prompt, response) pair from a first-person psychological game. Output STRICT JSON, no prose, no markdown.

For each choice decide:
1. PRIMARY/SECONDARY DEFENSE — pick from the 28 codebook names below. Choose what the *act of selecting this response* most plausibly enacts in context of the prompt. Use the UX tag as a soft prior, never a constraint.
2. DEFENSE_WEIGHTS — 1-3 weighted candidates summing to 1.0; this is the runtime vote input. Always include primary; add secondary/tertiary only when meaningfully co-present.
3. APPLICABLE — set false ONLY for navigational/UI-style choices that carry no defensive signal (e.g. "continue", pure scene-setters with no inner stance). Set true otherwise.
4. CONFIDENCE — subjective certainty in primary_defense, [0,1].
5. REASONING — 1-2 sentences linking specific phrases in label/prompt to codebook signals.
6. METAPHORS / OPERATIONS / MOTIFS — 0-3 / 0-3 / 0-4 from the CLOSED vocabs only. Out-of-vocab → *_novel.
7. VAD — valence/arousal/dominance each in [0,1]; the affective stance the CHOICE conveys (not the prompt).

UX TAG MEANINGS (soft priors only):
{tag_hint}

CLOSED VOCABULARIES:
{vocab}

CODEBOOK (28 defenses):
{codebook}
"""

USER_TMPL = """ROOM: {room}  ITEM: {item_id}  TAG: {tag}  ({tag_meaning})

PROMPT (what the player sees before choosing):
{prompt}

CHOSEN RESPONSE:
{label}

Output JSON exactly:
{{
  "applicable": <true|false>,
  "primary_defense":   "<exact codebook name>",
  "secondary_defense": <"<exact codebook name>"|null>,
  "defense_weights": [{{"defense":"<name>", "weight":<0.0-1.0>}}, ...],
  "confidence": <0.0-1.0>,
  "reasoning": "<1-2 sentences>",
  "metaphors":  [<0-3 from METAPHORS>],
  "operations": [<0-3 from OPERATIONS>],
  "motifs":     [<0-4 from MOTIFS>],
  "metaphors_novel":  [<any oov>],
  "operations_novel": [<any oov>],
  "motifs_novel":     [<any oov>],
  "valence": <0.0-1.0>, "arousal": <0.0-1.0>, "dominance": <0.0-1.0>
}}"""


def build_system_blocks(cb: dict) -> list[dict]:
    text = SYSTEM_TMPL.format(
        vocab=render_vocab_block(),
        codebook=render_codebook(cb),
        tag_hint='\n'.join(f'  {k}: {v}' for k, v in TAG_HINT.items()),
    )
    return [{'type': 'text', 'text': text, 'cache_control': {'type': 'ephemeral'}}]


def label_one(system_blocks, ch: dict) -> tuple[dict, dict]:
    user = USER_TMPL.format(
        room=ch['room'], item_id=ch['item_id'], tag=ch['tag'],
        tag_meaning=TAG_HINT.get(ch['tag'], '?'),
        prompt=ch['prompt'], label=ch['label'],
    )
    resp = client.messages.create(
        model=MODEL, max_tokens=600, system=system_blocks,
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

_DEFENSE_ALIAS: dict[str, str] = {
    'delusional projection': 'Projection',
    'psychotic denial':      'Denial',
    'psychotic distortion':  'Denial',
}


def _canon_defense(v: str | None, defense_set: set[str]) -> tuple[str | None, str | None]:
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
    for fld in ('primary_defense', 'secondary_defense'):
        canon, warn = _canon_defense(label.get(fld), defense_set)
        label[fld] = canon
        if warn:
            label.setdefault('_warnings', []).append(f'{fld}: {warn}')
    label['vaillant_level'] = VAILLANT_LEVEL.get(label.get('primary_defense') or '', None)
    for k, vocab in _VOCAB_BY_AXIS.items():
        kn = f'{k}_novel'
        proposed   = list(label.get(k, []))
        novel_in   = list(label.get(kn, []))
        proposed_in    = [x for x in proposed if x in vocab]
        proposed_novel = [x for x in proposed if x not in vocab]
        novel_promoted = [x for x in novel_in if x in vocab]
        novel_kept     = [x for x in novel_in if x not in vocab]
        label[k]  = sorted(set(proposed_in + novel_promoted))
        label[kn] = sorted(set(proposed_novel + novel_kept))
    label.update(clamp_vad({k: label.get(k, 0.5) for k in ('valence', 'arousal', 'dominance')}))
    label['confidence'] = max(0.0, min(1.0, float(label.get('confidence', 0.0))))
    label['applicable'] = bool(label.get('applicable', True))
    # normalize defense_weights: drop OOV defenses, renormalize to sum 1.0
    weights = []
    for w in (label.get('defense_weights') or []):
        canon, _ = _canon_defense(w.get('defense'), defense_set)
        if canon and isinstance(w.get('weight'), (int, float)) and w['weight'] > 0:
            weights.append({'defense': canon, 'weight': float(w['weight'])})
    s = sum(w['weight'] for w in weights)
    if s > 0:
        for w in weights:
            w['weight'] = round(w['weight'] / s, 4)
    label['defense_weights'] = weights
    return label


def main() -> None:
    ap = argparse.ArgumentParser()
    ap.add_argument('--limit', type=int, default=0)
    ap.add_argument('--output', type=Path, default=OUT_PATH_DEF)
    args = ap.parse_args()

    cb = json.loads(CODEBOOK_PATH.read_text(encoding='utf-8'))
    rows = json.loads(RAW_PATH.read_text(encoding='utf-8'))
    defense_set = set(DEFENSES)
    print(f'codebook: {len(cb)}  choices: {len(rows)}  vocab: {len(cb)} defs / 10 / 10 / 41')

    existing: list[dict] = []
    if args.output.exists():
        raw_existing = json.loads(args.output.read_text(encoding='utf-8'))
        existing = [r for r in raw_existing if r.get('primary_defense')]
        dropped = len(raw_existing) - len(existing)
        print(f'resume  : {len(existing)} done' +
              (f' (re-queueing {dropped} error/null rows)' if dropped else ''))
    done_keys = {(r['room'], r['item_id'], r['event_index'], r['choice_index']) for r in existing}

    system_blocks = build_system_blocks(cb)
    lex = Empath()
    results = list(existing)
    total = {'input': 0, 'output': 0, 'cache_read': 0, 'cache_create': 0}
    t0 = time.time()
    new_count = 0

    pending = [r for r in rows
               if (r['room'], r['item_id'], r['event_index'], r['choice_index']) not in done_keys]
    if args.limit > 0:
        pending = pending[:args.limit]
    print(f'pending : {len(pending)}\n')

    for ch in pending:
        try:
            label, usage = label_one(system_blocks, ch)
            for k in total: total[k] += usage[k]
            label = normalize(label, defense_set)
            empath_text = f"{ch['prompt']} {ch['label']}"
            empath_scores = lex.analyze(empath_text, normalize=True) or {}
            label['empath']     = {k: v for k, v in empath_scores.items() if v > 0}
            label['empath_top'] = empath_top_categories(empath_scores, k=EMPATH_TOP_K)
            results.append({**ch, **label})
            new_count += 1
            mark = '✓' if label['applicable'] else '·'
            pd = label.get('primary_defense') or '?'
            conf = label.get('confidence')
            conf_s = f'{conf:.2f}' if isinstance(conf, (int, float)) else 'n/a'
            print(f"[{len(results):4d}/{len(rows)}] {mark} R{ch['room']} {ch['item_id'][:18]:18s} "
                  f"ev{ch['event_index']}.{ch['choice_index']} {ch['tag']} → {pd:25s} (conf {conf_s})")
        except Exception as e:
            results.append({**ch, '_error': str(e)[:300]})
            print(f"  FAIL R{ch['room']} {ch['item_id']} ev{ch['event_index']}.{ch['choice_index']}: {str(e)[:120]}")
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
