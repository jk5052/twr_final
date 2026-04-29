"""
방어기제 코드북 빌더.
추출된 lit 텍스트에서 각 방어기제 관련 passage 모음 → Claude로 구조화 entry 합성.
output: dataset/processed/defense_codebook.json
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

EXTRACTED_DIR = REPO_ROOT / 'twr' / 'dataset' / 'raw' / '_extracted'
PROCESSED_DIR = REPO_ROOT / 'twr' / 'dataset' / 'processed'
OUT_PATH = PROCESSED_DIR / 'defense_codebook.json'

client = Anthropic()
MODEL = 'claude-sonnet-4-5'

# stimuli_rag에 있는 28개. 표기는 lit과 매칭되는 표준형.
DEFENSES = [
    ('Acting Out', 'immature'),
    ('Affiliation', 'mature'),
    ('Altruism', 'mature'),
    ('Anticipation', 'mature'),
    ('Apathetic Withdrawal', 'immature'),
    ('Autistic Fantasy', 'immature'),
    ('Denial', 'psychotic'),
    ('Devaluation', 'neurotic'),
    ('Displacement', 'neurotic'),
    ('Dissociation', 'neurotic'),
    ('Help-Rejecting Complaining', 'immature'),
    ('Humor', 'mature'),
    ('Idealization', 'neurotic'),
    ('Intellectualization', 'neurotic'),
    ('Isolation of Affect', 'neurotic'),
    ('Omnipotence', 'psychotic'),
    ('Passive Aggression', 'immature'),
    ('Projection', 'immature'),
    ('Projective Identification', 'neurotic'),
    ('Rationalization', 'neurotic'),
    ('Reaction Formation', 'neurotic'),
    ('Repression', 'neurotic'),
    ('Self-Assertion', 'mature'),
    ('Self-Observation', 'mature'),
    ('Splitting', 'psychotic'),
    ('Sublimation', 'mature'),
    ('Suppression', 'mature'),
    ('Undoing', 'neurotic'),
]

# ---------------------------------------------------------------
# passage 수집
# ---------------------------------------------------------------

PAGE_SPLIT = re.compile(r'\n*===== PAGE \d+ =====\n')


def load_corpus() -> list[tuple[str, int, str]]:
    """[(source, page, page_text), ...]"""
    corpus = []
    for txt_path in sorted(EXTRACTED_DIR.glob('*.txt')):
        text = txt_path.read_text(encoding='utf-8')
        pages = PAGE_SPLIT.split(text)
        for page_idx, page_text in enumerate(pages):
            if len(page_text.strip()) < 100:
                continue
            corpus.append((txt_path.stem, page_idx, page_text))
    return corpus


# lit에 정확히 같은 표기로 안 나오는 방어기제 동의어
SYNONYMS = {
    'Apathetic Withdrawal': ['schizoid fantasy', 'schizoid withdrawal', 'apathetic', 'withdrawal into fantasy'],
    'Help-Rejecting Complaining': ['help-rejecting', 'help rejecting', 'querulous'],
    'Self-Observation': ['self-observation', 'self observation', 'self-monitoring'],
    'Self-Assertion': ['self-assertion', 'self assertion', 'assertive'],
}


def search_passages(corpus, defense_name: str, max_passages: int = 12) -> list[str]:
    """defense를 직접 다루는 page 추림. 동의어 누적 카운트."""
    terms = [defense_name] + SYNONYMS.get(defense_name, [])
    patterns = [re.compile(re.escape(t), re.IGNORECASE) for t in terms]
    scored = []
    for source, page, page_text in corpus:
        total = sum(len(p.findall(page_text)) for p in patterns)
        if total == 0:
            continue
        scored.append((total, source, page, page_text))
    scored.sort(key=lambda x: -x[0])
    return [
        f'[Source: {s} p.{p}, mentions={m}]\n{t.strip()[:2500]}'
        for m, s, p, t in scored[:max_passages]
    ]


# ---------------------------------------------------------------
# Claude 합성
# ---------------------------------------------------------------

SYSTEM_PROMPT = """You are a clinical psychologist building a defense-mechanism codebook from primary literature (Vaillant, McWilliams, Cramer, DMRS, DSQ, etc.).
For each defense, synthesize a structured entry grounded in the provided passages.
Be precise about differentiation from semantically-near defenses.
Output STRICTLY valid JSON. No prose, no markdown."""

USER_TEMPLATE = """Defense: {name}
Vaillant level: {level}

Below are passages from clinical literature mentioning this defense. Synthesize a codebook entry.

{passages}

---

Output schema (valid JSON, no extra fields):
{{
  "name": "{name}",
  "vaillant_level": "{level}",
  "definition": "1-3 sentence operational definition synthesized from the passages above. Cite which sources informed it implicitly through wording.",
  "linguistic_signals": ["short verbal markers — exact phrasings or sentence patterns the defense produces (5-10 items)"],
  "narrative_patterns": ["typical narrative moves — what the speaker does in their account (3-6 items)"],
  "example_dsq_items": ["if any DSQ/DMRS items are quoted in the passages, list them verbatim (0-5 items)"],
  "differentiation": {{
    "vs_<other_defense_name>": "1-sentence distinction. Pick 2-3 of the most easily confused defenses."
  }},
  "literary_cues": "2-3 sentences on how this defense manifests in poetic voice — imagery, syntax, stance — not surface vocabulary.",
  "primary_sources_cited": ["source filenames that contributed most"]
}}"""


def _call_claude(name, level, passages, retry_hint=None):
    user_msg = USER_TEMPLATE.format(name=name, level=level, passages='\n\n---\n\n'.join(passages))
    if retry_hint:
        user_msg += f'\n\nIMPORTANT: previous attempt failed JSON parse: {retry_hint}. Use single quotes or rephrase to avoid embedded double-quotes inside string values.'
    resp = client.messages.create(
        model=MODEL,
        max_tokens=2048,
        system=SYSTEM_PROMPT,
        messages=[
            {'role': 'user', 'content': user_msg},
            {'role': 'assistant', 'content': '{'},  # prefill — force JSON start
        ],
    )
    return '{' + resp.content[0].text


def synthesize(name: str, level: str, passages: list[str]) -> dict:
    if not passages:
        return {'name': name, 'vaillant_level': level, '_error': 'no passages found'}

    for attempt in range(3):
        raw = _call_claude(name, level, passages, retry_hint=getattr(synthesize, '_last_err', None))
        raw = raw.strip()
        if raw.startswith('```'):
            raw = re.sub(r'^```(?:json)?\s*|\s*```$', '', raw, flags=re.MULTILINE)
        # 잘린 응답 보정
        if not raw.endswith('}'):
            raw = raw.rsplit(',', 1)[0] + '}'
        try:
            return json.loads(raw)
        except json.JSONDecodeError as e:
            synthesize._last_err = str(e)
            if attempt == 2:
                raise
            time.sleep(1)


def main():
    corpus = load_corpus()
    print(f'Loaded {len(corpus)} pages from {len(set(c[0] for c in corpus))} sources\n')

    # 재시작 가능: 기존 결과 로드
    codebook = {}
    if OUT_PATH.exists():
        codebook = json.loads(OUT_PATH.read_text(encoding='utf-8'))
        print(f'Existing codebook: {len(codebook)} entries\n')

    for i, (name, level) in enumerate(DEFENSES):
        if name in codebook and '_error' not in codebook[name]:
            print(f'[{i+1}/{len(DEFENSES)}] {name} — skip (cached)')
            continue
        passages = search_passages(corpus, name, max_passages=10)
        print(f'[{i+1}/{len(DEFENSES)}] {name} — {len(passages)} passages')
        try:
            entry = synthesize(name, level, passages)
            codebook[name] = entry
            OUT_PATH.write_text(json.dumps(codebook, indent=2, ensure_ascii=False), encoding='utf-8')
            time.sleep(0.5)
        except Exception as e:
            print(f'  FAIL: {e}')
            codebook[name] = {'name': name, 'vaillant_level': level, '_error': str(e)}
            OUT_PATH.write_text(json.dumps(codebook, indent=2, ensure_ascii=False), encoding='utf-8')

    print(f'\nDone. {OUT_PATH}')


if __name__ == '__main__':
    main()
