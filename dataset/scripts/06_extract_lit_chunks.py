"""
Defense-anchored chunk extraction from priority clinical-lit .txt files.
For each occurrence of a 28-codebook defense name (or synonym), grab a
±WINDOW-word window. Adjacent mentions within MERGE_GAP words are merged
into one chunk; chunk inherits the union of triggering defenses as priors.

input  : twr/dataset/raw/_extracted/<priority sources>.txt
output : twr/dataset/processed/lit_chunks_raw.json
        [{source, chunk_id, text, char_start, char_end, page_start, page_end,
          anchor_defenses[], anchor_terms[], anchor_count, word_count}]
"""
import json
import re
import sys
from pathlib import Path

REPO_ROOT = Path(__file__).resolve().parents[3]
sys.path.insert(0, str(Path(__file__).resolve().parent))
from _tagging_vocab import DEFENSES  # noqa: E402

EXTRACTED = REPO_ROOT / 'twr' / 'dataset' / 'raw' / '_extracted'
OUT_PATH  = REPO_ROOT / 'twr' / 'dataset' / 'processed' / 'lit_chunks_raw.json'

# narrative-rich sources (file stems, no extension)
LIT_PRIORITY: tuple[str, ...] = (
    'WisdomoftheEgo',
    'Psychoanalytic_Diagnosis_-_Nancy_McWilli',
    'Adaptation_to_life',
    'psychodynamic-psychiatry-in-clinical-practice-fifth-edition-9781585624430-1585624438_compress',
    'Cramer-Understanding-Defense-Mechanisms (1)',
    'Defenses in Everyday Life',
    'Psychotherapy Using_the_Defense_Mechanism_Rating_Scales',
)

# defenses whose codebook spelling rarely appears verbatim in lit prose
SYNONYMS: dict[str, tuple[str, ...]] = {
    'Apathetic Withdrawal':       ('schizoid fantasy', 'schizoid withdrawal', 'apathetic'),
    'Help-Rejecting Complaining': ('help-rejecting', 'help rejecting', 'querulous'),
    'Self-Observation':           ('self-observation', 'self observation', 'self-monitoring'),
    'Self-Assertion':             ('self-assertion', 'self assertion', 'assertive'),
    'Isolation of Affect':        ('isolation of affect', 'affective isolation'),
    'Reaction Formation':         ('reaction formation', 'reaction-formation'),
    'Projective Identification':  ('projective identification',),
    'Acting Out':                 ('acting out', 'acting-out'),
    'Autistic Fantasy':           ('autistic fantasy', 'autistic withdrawal'),
    'Passive Aggression':         ('passive aggression', 'passive-aggression', 'passive aggressive'),
}

WINDOW_WORDS   = 150       # ± each side
MERGE_GAP      = 200       # word-distance to merge anchors into one cluster
MAX_PER_PAIR   = 30        # cap chunks per (defense, source) — anti-skew
MIN_WORDS      = 80        # discard tiny fragments after page-marker strip
PAGE_RE        = re.compile(r'\n*=====\s*PAGE\s+(\d+)\s*=====\n*')
WORD_RE        = re.compile(r'\S+')

# per-page footers / running heads to strip globally before content checks
FOOTERS = (
    re.compile(r'www\.[a-z0-9.\-]+\.(?:org|com|net)\s*\d*', re.IGNORECASE),
    re.compile(r'^\s*\d+\s*$', re.MULTILINE),                     # bare page numbers
)
# strong front-matter / boilerplate signals (post-footer-strip, case-insensitive)
BOILERPLATE = (
    'table of contents', 'all rights reserved', 'library of congress',
    'isbn', 'copyright ©', 'first published',
    'this work may not be', 'reverse engineered',
)


def clean_body(text: str) -> str:
    """Strip page markers + footers; collapse whitespace; preserve paragraph breaks."""
    out = PAGE_RE.sub(' ', text)
    for f in FOOTERS:
        out = f.sub(' ', out)
    out = re.sub(r'[ \t]+', ' ', out)
    out = re.sub(r'\n{3,}', '\n\n', out)
    return out.strip()


TOC_LISTING_RE = re.compile(r'\b(?:Table|Figure|Chapter)\s+\d+\b')


def is_boilerplate(body: str) -> bool:
    head = body[:1500].lower()
    if any(p in head for p in BOILERPLATE):
        return True
    # TOC: 3+ Table/Figure/Chapter listing markers
    if len(TOC_LISTING_RE.findall(body)) >= 3:
        return True
    # short-line ratio TOC heuristic
    lines = [ln for ln in body.split('\n') if ln.strip()]
    if len(lines) >= 10:
        short = sum(1 for ln in lines if len(ln.split()) <= 6)
        if short / len(lines) > 0.65:
            return True
    return False


def page_at(text: str, char_pos: int) -> int:
    last = 1
    for m in PAGE_RE.finditer(text, 0, max(char_pos, 0) + 1):
        last = int(m.group(1))
    return last


def find_anchors(text: str) -> list[tuple[int, str, str]]:
    out: list[tuple[int, str, str]] = []
    for d in DEFENSES:
        terms = (d, *SYNONYMS.get(d, ()))
        for term in terms:
            patt = re.compile(r'(?<![A-Za-z])' + re.escape(term) + r'(?![A-Za-z])', re.IGNORECASE)
            for m in patt.finditer(text):
                out.append((m.start(), d, term))
    out.sort(key=lambda x: x[0])
    return out


def words_with_pos(text: str) -> list[tuple[int, int]]:
    return [(m.start(), m.end()) for m in WORD_RE.finditer(text)]


def char_to_word_idx(words: list[tuple[int, int]], char_pos: int) -> int:
    lo, hi = 0, len(words) - 1
    while lo <= hi:
        mid = (lo + hi) // 2
        if words[mid][1] <= char_pos:
            lo = mid + 1
        else:
            hi = mid - 1
    return min(max(lo, 0), len(words) - 1)


def extract_source(stem: str, source_text: str) -> list[dict]:
    anchors = find_anchors(source_text)
    if not anchors:
        return []
    words = words_with_pos(source_text)
    n_words = len(words)
    enriched = [(char_to_word_idx(words, c), d, t, c) for c, d, t in anchors]

    # cluster anchors within MERGE_GAP words into single chunks
    clusters: list[list[tuple[int, str, str, int]]] = [[enriched[0]]]
    for a in enriched[1:]:
        if a[0] - clusters[-1][-1][0] <= MERGE_GAP:
            clusters[-1].append(a)
        else:
            clusters.append([a])

    chunks: list[dict] = []
    pair_counter: dict[tuple[str, str], int] = {}
    for cl in clusters:
        wstart = max(cl[0][0]  - WINDOW_WORDS, 0)
        wend   = min(cl[-1][0] + WINDOW_WORDS, n_words - 1)
        cstart, cend = words[wstart][0], words[wend][1]
        body = clean_body(source_text[cstart:cend])
        wc = len(WORD_RE.findall(body))
        if wc < MIN_WORDS or is_boilerplate(body):
            continue
        anchor_defs = sorted({d for _, d, _, _ in cl})
        # cap per (primary anchor defense, source)
        primary = max(anchor_defs, key=lambda d: sum(1 for _, dd, _, _ in cl if dd == d))
        key = (primary, stem)
        pair_counter[key] = pair_counter.get(key, 0) + 1
        if pair_counter[key] > MAX_PER_PAIR:
            continue
        chunks.append({
            'source':           stem,
            'text':             body,
            'char_start':       cstart,
            'char_end':         cend,
            'page_start':       page_at(source_text, cstart),
            'page_end':         page_at(source_text, cend),
            'anchor_defenses':  anchor_defs,
            'anchor_terms':     sorted({t.lower() for _, _, t, _ in cl}),
            'anchor_count':     len(cl),
            'word_count':       wc,
        })
    return chunks


def main() -> None:
    OUT_PATH.parent.mkdir(parents=True, exist_ok=True)
    all_chunks: list[dict] = []
    for stem in LIT_PRIORITY:
        path = EXTRACTED / f'{stem}.txt'
        if not path.exists():
            print(f'  MISSING: {stem}'); continue
        text = path.read_text(encoding='utf-8')
        chunks = extract_source(stem, text)
        for i, c in enumerate(chunks):
            c['chunk_id'] = i
        per_def: dict[str, int] = {}
        for c in chunks:
            for d in c['anchor_defenses']:
                per_def[d] = per_def.get(d, 0) + 1
        top = sorted(per_def.items(), key=lambda x: -x[1])[:5]
        print(f'  {stem:60s} chunks={len(chunks):4d}  top={top}')
        all_chunks.extend(chunks)
    OUT_PATH.write_text(json.dumps(all_chunks, indent=2, ensure_ascii=False), encoding='utf-8')
    print(f'\nTotal: {len(all_chunks)} chunks → {OUT_PATH}')


if __name__ == '__main__':
    main()
