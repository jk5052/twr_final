"""
DSQ-60 (60문항, Thygesen thesis Appendix 2) + DMRS-SR-30 (30문항, Di Giuseppe et al. 2020 English version) raw item 추출.
output: dataset/processed/items_raw.json — Claude 라벨링 단계 입력.
"""
import json
import re
from pathlib import Path

REPO_ROOT = Path(__file__).resolve().parents[3]
EXT = REPO_ROOT / 'twr' / 'dataset' / 'raw' / '_extracted'
OUT = REPO_ROOT / 'twr' / 'dataset' / 'processed' / 'items_raw.json'

DSQ_FILE = EXT / 'The Defense Style Questionnaire 60 (DSQ-60).txt'
DMRS_FILE = EXT / 'Preliminary-Reliability-and Validity-of-the DMRS-SR-30.txt'


# ── DSQ-60 ─────────────────────────────────────────────────────────────
# Appendix 2 본문은 PDF page 87-90. text에 page marker 존재.
# OCR fix: standalone '1' that should be 'I' (word boundary), l'm/l've/l'd, double-letter UU,
# trailing rating scale "1 2 3 4 5 6 7 8 9", trailing dots/commas.

def _ocr_fix(s: str) -> str:
    # OCR pronoun/contraction recoveries
    s = re.sub(r"\bl'(m|ve|d|ll|s|re)\b", r"I'\1", s)
    s = s.replace(' Ifl ', ' If I ').replace(' Ifl-', ' If I-')
    s = s.replace("Ifl've", "If I've").replace("Ifl'm", "If I'm")
    s = s.replace("ifl'm", "if I'm").replace("ifl've", "if I've")
    s = s.replace("If! ", 'If I ').replace(' if! ', ' if I ').replace('as if!', 'as if I')
    s = s.replace('Ifsomeone', 'If someone').replace('ifyou', 'if you')
    s = s.replace('Vou ', 'You ').replace('aIl ', 'all ').replace('caIl', 'call')
    s = s.replace('wiU', 'will').replace('eut ', 'cut ').replace('rea1', 'real')
    s = s.replace('reaIly', 'really').replace('weIl ', 'well ').replace('teIl ', 'tell ')
    s = s.replace('myselfpretty', 'myself pretty').replace('myselfbeing', 'myself being')
    s = s.replace('emotionaIly', 'emotionally').replace('concemed', 'concerned')
    s = s.replace('reallife', 'real life').replace('oftime', 'of time')
    s = s.replace('sorne ', 'some ').replace(' tum ', ' turn ').replace('Ioften', 'I often')
    s = s.replace("ifs as", "it's as").replace('fee1', 'feel').replace('123456789', ' ')
    s = s.replace('Not at aU applicable to me', ' ').replace('Not at all applicable to me', ' ')
    s = s.replace('Completely applicable to me', ' ')
    # standalone '1' that should be 'I'
    s = re.sub(r'(?<=[\s,;:.])1(?=\s+[a-zA-Z])', 'I', s)
    s = re.sub(r'^1\s+', 'I ', s)
    s = re.sub(r'\.{2,}', ' ', s)
    s = re.sub(r'\s+', ' ', s).strip(' .,\'\"')
    return s


def extract_dsq() -> list[dict]:
    txt = DSQ_FILE.read_text(errors='ignore')
    pages = re.split(r'===== PAGE (\d+) =====', txt)
    body = ''
    for i in range(1, len(pages), 2):
        pn = int(pages[i])
        if 88 <= pn <= 90:                         # appendix item pages
            body += '\n' + pages[i + 1]
    # rating scale '1 2 3 4 5 6 7 8 9' 와 leader dots, page-footer 제거 후 한 줄 join.
    body = re.sub(r'1\s+2\s+3\s+4\s+5\s+6\s+7\s+8\s+9', ' ', body)
    body = re.sub(r'Not at a[lI][lI] applicable to me', ' ', body, flags=re.IGNORECASE)
    body = re.sub(r'Completely applicable to me', ' ', body, flags=re.IGNORECASE)
    body = re.sub(r'PLEASE GO TO THE NEXT PAGE.*', ' ', body)
    body = re.sub(r'THIS QUESTIONNAIRE.*', ' ', body, flags=re.DOTALL)
    body = re.sub(r'\.{2,}', ' ', body)            # leader dots
    body = re.sub(r'\n+', ' ', body)
    body = re.sub(r'\s+', ' ', body).strip()
    # item 분리: 'N.' 부터 'N+1.' 까지
    pattern = re.compile(r'(?P<num>\d{1,2})\.\s+(?P<text>.+?)(?=\s+\d{1,2}\.\s+|$)')
    seen: dict[int, dict] = {}
    for m in pattern.finditer(body):
        n = int(m.group('num'))
        if not (1 <= n <= 60):
            continue
        cleaned = _ocr_fix(m.group('text'))
        if 10 <= len(cleaned) <= 400:
            seen[n] = {'source': 'DSQ-60', 'item_id': n, 'raw_text': cleaned}
    return [seen[i] for i in sorted(seen)]


# ── DMRS-SR-30 ─────────────────────────────────────────────────────────
# 영어판 본문은 한 영역 (offset ~32925~). 'Did you' prefix, 단어 사이 공백 없음.
# extraction은 단순 split — segmentation은 라벨 단계에서 Claude가 처리.

def extract_dmrs() -> list[dict]:
    txt = DMRS_FILE.read_text(errors='ignore')
    # 영어판 30문항 블록 찾기 (TABLE7 라벨 직전 instructional sentence "Inthepastweek")
    m = re.search(r'Inthepastweek,\s*howmuchdidyoudealwithdifficult.*?(?=TABLE\s*8|FrontiersinPsychiatry\s*\|.*?Article870\s*===== PAGE 8 =====|\Z)',
                  txt, re.DOTALL)
    if not m:
        raise RuntimeError('DMRS-SR-30 English block not located')
    block = m.group(0)
    # 30 lines numbered "1)" through "30)"
    pattern = re.compile(r'(?P<num>\d{1,2})\)\s*(?P<text>[^\n]+)')
    items = []
    for mm in pattern.finditer(block):
        n = int(mm.group('num'))
        if 1 <= n <= 30:
            txt_raw = mm.group('text').strip()
            items.append({'source': 'DMRS-SR-30', 'item_id': n, 'raw_text': txt_raw})
    return items


def main() -> None:
    dsq = extract_dsq()
    dmrs = extract_dmrs()
    print(f'DSQ-60   : {len(dsq)} items')
    print(f'DMRS-SR-30: {len(dmrs)} items')

    # quick preview
    print('\n--- DSQ sample ---')
    for it in dsq[:3] + dsq[-2:]:
        print(f"  {it['item_id']:2d}. {it['raw_text'][:120]}")
    print('\n--- DMRS sample ---')
    for it in dmrs[:3] + dmrs[-2:]:
        print(f"  {it['item_id']:2d}. {it['raw_text'][:120]}")

    out = dsq + dmrs
    OUT.write_text(json.dumps(out, indent=2, ensure_ascii=False), encoding='utf-8')
    print(f'\nsaved: {OUT}  ({len(out)} items)')


if __name__ == '__main__':
    main()
