"""
50편 sample 태깅으로 프롬프트 + 스키마 검증.
output: dataset/processed/poems_tagged_sample.json
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
OUT_PATH = DATASET / 'processed' / 'poems_tagged_sample.json'

client = Anthropic()
MODEL = 'claude-sonnet-4-5'
SAMPLE_N = 50
SEED = 42


def render_codebook(cb: dict) -> str:
    """code 블록을 짧고 명확한 텍스트로 펼침. 차별화 포함."""
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
    """system blocks. codebook은 cache_control 표시."""
    codebook_text = render_codebook(cb)
    instructions = SYSTEM_INSTRUCTIONS.format(codebook=codebook_text)
    return [{
        'type': 'text',
        'text': instructions,
        'cache_control': {'type': 'ephemeral'},
    }]


def tag_poem(system_blocks, title: str, author: str, content: str) -> tuple[dict, dict]:
    """returns (parsed_tag, usage)."""
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
    sample = df.sample(n=SAMPLE_N, random_state=SEED).reset_index(drop=True)
    print(f'codebook: {len(cb)} defenses')
    print(f'sample: {len(sample)} poems (seed={SEED})\n')

    system_blocks = build_system(cb)
    results = []
    total_usage = {'input': 0, 'output': 0, 'cache_read': 0, 'cache_create': 0}

    for i, row in sample.iterrows():
        title = str(row['poem name']).strip()[:80]
        author = str(row.get('author') or 'unknown')
        content = str(row['content']).replace('\r', '').strip()
        try:
            tag, usage = tag_poem(system_blocks, title, author, content)
            for k in total_usage:
                total_usage[k] += usage[k]
            results.append({
                'poem_name': title,
                'author': author,
                'content': content,
                'word_count': int(row.get('word_count', 0)),
                **tag,
            })
            applicable_mark = '✓' if tag.get('applicable') else '·'
            primary = tag.get('primary_defense') or '—'
            intensity = tag.get('intensity') if tag.get('intensity') is not None else '—'
            print(f"[{i+1:2d}/{SAMPLE_N}] {applicable_mark} {primary:25s} i={intensity} "
                  f"{title[:40]} (cache_read={usage['cache_read']})")
        except Exception as e:
            print(f'[{i+1}] FAIL: {title[:40]}: {e}')
            results.append({'poem_name': title, 'author': author, '_error': str(e)})
        OUT_PATH.write_text(json.dumps(results, indent=2, ensure_ascii=False), encoding='utf-8')
        time.sleep(0.2)

    print(f'\n=== usage ===')
    print(f'input (uncached): {total_usage["input"]:,}')
    print(f'cache write     : {total_usage["cache_create"]:,}')
    print(f'cache read      : {total_usage["cache_read"]:,}')
    print(f'output          : {total_usage["output"]:,}')
    # rough cost: input $3/M, output $15/M, cache_read $0.30/M, cache_write $3.75/M
    cost = (total_usage['input'] * 3 + total_usage['cache_create'] * 3.75
            + total_usage['cache_read'] * 0.30 + total_usage['output'] * 15) / 1_000_000
    print(f'rough cost: ${cost:.3f}')
    print(f'\nSaved: {OUT_PATH}')


if __name__ == '__main__':
    main()
