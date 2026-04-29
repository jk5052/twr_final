"""
2874편 전체 태깅. resume 지원 (기존 결과 skip).
output: dataset/processed/poems_tagged.json
"""
import json
import os
import re
import time
from pathlib import Path
import pandas as pd
from anthropic import Anthropic
from dotenv import load_dotenv

REPO_ROOT = Path(__file__).resolve().parents[3]
load_dotenv(REPO_ROOT / '.env')

DATASET = REPO_ROOT / 'twr' / 'dataset'
CODEBOOK_PATH = DATASET / 'processed' / 'defense_codebook.json'
POEMS_PATH = DATASET / 'raw' / 'poems_filtered.csv'
OUT_PATH = DATASET / 'processed' / 'poems_tagged.json'
SAVE_EVERY = 10  # disk write 빈도

client = Anthropic()
MODEL = 'claude-sonnet-4-5'


def render_codebook(cb: dict) -> str:
    parts = []
    for name, e in cb.items():
        if '_error' in e:
            continue
        diff = e.get('differentiation', {}) or {}
        diff_str = ' | '.join(f'{k.replace("vs_", "vs ").replace("_", " ")}: {v}'
                              for k, v in diff.items())
        parts.append(
            f'## {name} ({e.get("vaillant_level", "?")})\n'
            f'Definition: {e.get("definition", "")}\n'
            f'Linguistic signals: {"; ".join(e.get("linguistic_signals", []))}\n'
            f'Narrative patterns: {"; ".join(e.get("narrative_patterns", []))}\n'
            f'Literary cues: {e.get("literary_cues", "")}\n'
            + (f'Differentiation: {diff_str}\n' if diff_str else '')
        )
    return '\n'.join(parts)


SYSTEM_INSTRUCTIONS = """You are a clinical psychologist analyzing poems for the speaker's defense-mechanism stance.
Use ONLY the codebook below. Do not invent defenses. Output STRICT JSON.

What you tag is the SPEAKER's psychological stance toward the poem's situation — not surface vocabulary, not the poet's biography. A poem with the word "escape" is not necessarily about avoidance; a poem without that word may show the core of denial.

Many poems do not display a clear defense (descriptive landscape, formal experiment, simple love lyric). Mark those `applicable: false`.

CODEBOOK:
{codebook}
"""

USER_TEMPLATE = """Poem title: {title}
Author: {author}

{content}

---
Output JSON (no markdown, no prose):
{{
  "primary_defense": "<one of 28 codebook names, or null if applicable=false>",
  "secondary_defense": "<one of 28 names, or null>",
  "intensity": <integer 1-5: 1=barely traceable, 3=clear, 5=consuming the speaker>,
  "stance": "<one of: confession | address | observation | meditation>",
  "evidence": "<1-2 sentence quote or paraphrase showing the defense in this poem>",
  "confidence": <float 0-1>,
  "applicable": <true|false>
}}"""


def build_system(cb: dict) -> list[dict]:
    codebook_text = render_codebook(cb)
    instructions = SYSTEM_INSTRUCTIONS.format(codebook=codebook_text)
    return [{
        'type': 'text',
        'text': instructions,
        'cache_control': {'type': 'ephemeral'},
    }]


def tag_poem(system_blocks, title: str, author: str, content: str) -> tuple[dict, dict]:
    user = USER_TEMPLATE.format(title=title.strip(), author=author or 'unknown', content=content.strip())
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
    tag = json.loads(raw)
    usage = {
        'input': resp.usage.input_tokens,
        'output': resp.usage.output_tokens,
        'cache_read': getattr(resp.usage, 'cache_read_input_tokens', 0) or 0,
        'cache_create': getattr(resp.usage, 'cache_creation_input_tokens', 0) or 0,
    }
    return tag, usage


def main():
    cb = json.loads(CODEBOOK_PATH.read_text(encoding='utf-8'))
    df = pd.read_csv(POEMS_PATH)
    print(f'codebook: {len(cb)} defenses')
    print(f'poems: {len(df)}')

    # resume
    existing = []
    done_keys = set()
    if OUT_PATH.exists():
        existing = json.loads(OUT_PATH.read_text(encoding='utf-8'))
        done_keys = {(r['poem_name'], r.get('author', '')) for r in existing}
        print(f'resume: {len(existing)} already done\n')

    system_blocks = build_system(cb)
    results = list(existing)
    total_usage = {'input': 0, 'output': 0, 'cache_read': 0, 'cache_create': 0}
    t0 = time.time()
    new_count = 0
    fail_count = 0

    for i, row in df.iterrows():
        title = str(row['poem name']).strip()[:200]
        author = str(row.get('author') or 'unknown')
        if (title, author) in done_keys:
            continue
        content = str(row['content']).replace('\r', '').strip()
        try:
            tag, usage = tag_poem(system_blocks, title, author, content)
            for k in total_usage:
                total_usage[k] += usage[k]
            results.append({
                'poem_name': title,
                'author': author,
                'content': content,
                'word_count': int(row.get('word_count', 0) or 0),
                **tag,
            })
            new_count += 1
            if new_count % 25 == 1:
                mark = '✓' if tag.get('applicable') else '·'
                primary = tag.get('primary_defense') or '—'
                intensity = tag.get('intensity') if tag.get('intensity') is not None else '—'
                elapsed = time.time() - t0
                rate = new_count / elapsed if elapsed > 0 else 0
                eta_s = (len(df) - len(results)) / rate if rate > 0 else 0
                print(f"[{len(results):4d}/{len(df)}] {mark} {primary:25s} i={intensity} "
                      f"{title[:35]:35s} | {rate:.2f}/s ETA={eta_s/60:.0f}m  cost~${(total_usage['input']*3+total_usage['cache_create']*3.75+total_usage['cache_read']*0.30+total_usage['output']*15)/1_000_000:.2f}")
        except Exception as e:
            fail_count += 1
            print(f'  FAIL [{i}] {title[:40]}: {str(e)[:120]}')
            results.append({
                'poem_name': title, 'author': author,
                'content': content, 'word_count': int(row.get('word_count', 0) or 0),
                '_error': str(e)[:300],
            })
        if new_count % SAVE_EVERY == 0 or fail_count > 0:
            OUT_PATH.write_text(json.dumps(results, indent=2, ensure_ascii=False), encoding='utf-8')

    OUT_PATH.write_text(json.dumps(results, indent=2, ensure_ascii=False), encoding='utf-8')

    print(f'\n=== DONE ===')
    print(f'total: {len(results)}  new: {new_count}  failed: {fail_count}')
    print(f'time: {(time.time()-t0)/60:.1f}m')
    print(f'tokens — in:{total_usage["input"]:,}  cache_w:{total_usage["cache_create"]:,}  '
          f'cache_r:{total_usage["cache_read"]:,}  out:{total_usage["output"]:,}')
    cost = (total_usage['input'] * 3 + total_usage['cache_create'] * 3.75
            + total_usage['cache_read'] * 0.30 + total_usage['output'] * 15) / 1_000_000
    print(f'cost: ${cost:.2f}')
    print(f'\nSaved: {OUT_PATH}')


if __name__ == '__main__':
    main()
