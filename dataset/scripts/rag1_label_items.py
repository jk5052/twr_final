"""
DSQ-60 + DMRS-SR-30 90문항을 28개 codebook defense에 라벨링.
- input : processed/items_raw.json
- output: processed/items_labeled.json
- DMRS 영문판은 단어 사이 공백이 없으므로 라벨링과 함께 segmentation 동반.
"""
import json
import os
import re
import time
from pathlib import Path
from anthropic import Anthropic
from dotenv import load_dotenv

REPO_ROOT = Path(__file__).resolve().parents[3]
load_dotenv(REPO_ROOT / '.env')

DATASET = REPO_ROOT / 'twr' / 'dataset'
CODEBOOK_PATH = DATASET / 'processed' / 'defense_codebook.json'
RAW_PATH = DATASET / 'processed' / 'items_raw.json'
OUT_PATH = DATASET / 'processed' / 'items_labeled.json'

client = Anthropic()
MODEL = 'claude-sonnet-4-5'

# DMRS-SR-30 Table 1 (Di Giuseppe 2020) 30 items에 대응되는 defense levels — Claude의 사전 지식 보강용 컨텍스트.
DMRS_TABLE1 = """DMRS-SR-30 hierarchical reference (Di Giuseppe et al. 2020, Table 1):
- Mature/High Adaptive   : affiliation, altruism, anticipation, humor, self-assertion, self-observation, sublimation, suppression
- Obsessional (Neurotic) : intellectualization, isolation of affect, undoing
- Other Neurotic         : displacement, dissociation, reaction formation, repression
- Minor image-distorting : devaluation, idealization, omnipotence
- Disavowal              : denial, projection, rationalization, autistic fantasy
- Major image-distorting : projective identification, splitting of self-image, splitting of other's image
- Action                 : acting out, help-rejecting complaining, passive aggression
Note: DMRS "splitting of self-image" + "splitting of other's image" both map to codebook **Splitting**."""


def render_codebook(cb: dict) -> str:
    parts = []
    for name, e in cb.items():
        if '_error' in e:
            continue
        parts.append(
            f'## {name} ({e.get("vaillant_level", "?")})\n'
            f'Definition: {e.get("definition", "")}\n'
            f'Linguistic signals: {"; ".join(e.get("linguistic_signals", []))}\n'
            f'Narrative patterns: {"; ".join(e.get("narrative_patterns", []))}'
        )
    return '\n'.join(parts)


SYSTEM_INSTRUCTIONS = """You are a clinical psychologist assigning self-report defense-mechanism inventory items to the 28 defenses defined in the codebook below.
Output STRICT JSON only. Pick `primary_defense` from the codebook names exactly.

For DMRS-SR-30 items the source text has NO whitespace between words (Italian-source PDF artifact). Restore proper English word boundaries in `clean_text`.
For DSQ-60 items the text is already clean — copy as-is into `clean_text` (you may fix obvious residual OCR if any).

Pick `primary_defense` based on the construct the item is designed to measure, not surface vocabulary.
`secondary_defense` is OPTIONAL — only set if a second mechanism is also clearly tapped (e.g., DSQ #19 "Actually I'm pretty worthless" — primary Devaluation [of self], secondary Apathetic Withdrawal). Otherwise null.

CODEBOOK:
{codebook}

{dmrs_table}
"""

USER_TEMPLATE = """SOURCE: {source}
ITEM_ID: {item_id}
TEXT: {text}

Output JSON (no markdown, no prose):
{{
  "clean_text": "<text with proper spacing/punctuation>",
  "primary_defense": "<exact codebook name>",
  "secondary_defense": "<exact codebook name, or null>",
  "reasoning": "<1-2 sentences linking the item content to the chosen defense via codebook signals>"
}}"""


def build_system(cb: dict) -> list[dict]:
    text = SYSTEM_INSTRUCTIONS.format(codebook=render_codebook(cb), dmrs_table=DMRS_TABLE1)
    return [{'type': 'text', 'text': text, 'cache_control': {'type': 'ephemeral'}}]


def label_item(system_blocks, it: dict) -> tuple[dict, dict]:
    user = USER_TEMPLATE.format(source=it['source'], item_id=it['item_id'], text=it['raw_text'])
    resp = client.messages.create(
        model=MODEL,
        max_tokens=512,
        system=system_blocks,
        messages=[
            {'role': 'user', 'content': user},
            {'role': 'assistant', 'content': '{'},
        ],
    )
    raw = '{' + resp.content[0].text
    raw = raw.strip()
    if raw.startswith('```'):
        raw = re.sub(r'^```(?:json)?\s*|\s*```$', '', raw, flags=re.MULTILINE)
    if not raw.endswith('}'):
        raw = raw.rsplit(',', 1)[0] + '}'
    label = json.loads(raw)
    usage = {
        'input': resp.usage.input_tokens,
        'output': resp.usage.output_tokens,
        'cache_read': getattr(resp.usage, 'cache_read_input_tokens', 0) or 0,
        'cache_create': getattr(resp.usage, 'cache_creation_input_tokens', 0) or 0,
    }
    return label, usage


def main() -> None:
    cb = json.loads(CODEBOOK_PATH.read_text(encoding='utf-8'))
    items = json.loads(RAW_PATH.read_text(encoding='utf-8'))
    print(f'codebook: {len(cb)} defenses')
    print(f'items   : {len(items)}')

    existing: list[dict] = []
    done_keys: set[tuple[str, int]] = set()
    if OUT_PATH.exists():
        existing = json.loads(OUT_PATH.read_text(encoding='utf-8'))
        done_keys = {(r['source'], r['item_id']) for r in existing if '_error' not in r}
        print(f'resume  : {len(existing)} done\n')

    system_blocks = build_system(cb)
    results = list(existing)
    total = {'input': 0, 'output': 0, 'cache_read': 0, 'cache_create': 0}
    t0 = time.time()
    new_count = 0
    cb_names = set(cb.keys())

    # error 항목 + primary_defense 누락 항목은 재시도
    results = [r for r in results if '_error' not in r and r.get('primary_defense')]
    done_keys = {(r['source'], r['item_id']) for r in results}
    print(f'usable  : {len(results)} (will retry {len(items) - len(results)})\n')

    for it in items:
        if (it['source'], it['item_id']) in done_keys:
            continue
        try:
            label, usage = label_item(system_blocks, it)
            for k in total:
                total[k] += usage[k]
            for fld in ('primary_defense', 'secondary_defense'):
                v = label.get(fld)
                if not v:
                    continue
                # 'Splitting (psychotic)' → 'Splitting' 형태의 trailing 괄호 표기 제거
                v_clean = re.sub(r'\s*\([^)]+\)\s*$', '', v).strip()
                if v_clean in cb_names:
                    label[fld] = v_clean
                else:
                    label[fld] = None
                    label.setdefault('_warnings', []).append(f'{fld} "{v}" not in codebook → null')
            results.append({**it, **label})
            new_count += 1
            primary = label.get('primary_defense') or '???'
            secondary = label.get('secondary_defense') or '—'
            print(f"[{len(results):3d}/{len(items)}] {it['source']:11s} #{it['item_id']:2d} → "
                  f"{primary:27s} (+{secondary})")
        except Exception as e:
            results.append({**it, '_error': str(e)[:300]})
            print(f"  FAIL {it['source']} #{it['item_id']}: {str(e)[:100]}")
        OUT_PATH.write_text(json.dumps(results, indent=2, ensure_ascii=False), encoding='utf-8')

    cost = (total['input'] * 3 + total['cache_create'] * 3.75
            + total['cache_read'] * 0.30 + total['output'] * 15) / 1_000_000
    print(f'\n=== DONE ===  new:{new_count} cost:${cost:.3f} time:{(time.time()-t0)/60:.1f}m')
    print(f'tokens — in:{total["input"]:,} cache_w:{total["cache_create"]:,} '
          f'cache_r:{total["cache_read"]:,} out:{total["output"]:,}')
    print(f'saved: {OUT_PATH}')


if __name__ == '__main__':
    main()
