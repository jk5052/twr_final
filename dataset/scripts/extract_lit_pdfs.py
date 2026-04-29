"""
방어기제 임상 lit PDF → 텍스트 추출.
output: dataset/raw/_extracted/{stem}.txt
"""
import sys
import time
from pathlib import Path
import pdfplumber

REPO_ROOT = Path(__file__).resolve().parents[3]
RAW_DIR = REPO_ROOT / 'twr' / 'dataset' / 'raw'
OUT_DIR = RAW_DIR / '_extracted'
OUT_DIR.mkdir(exist_ok=True)

# 우선순위 — 핵심 lit 7개
PRIORITY = [
    'Psychoanalytic_Diagnosis_-_Nancy_McWilli.pdf',
    'WisdomoftheEgo.pdf',
    'Cramer-Understanding-Defense-Mechanisms (1).pdf',
    'Preliminary-Reliability-and Validity-of-the DMRS-SR-30.pdf',
    'The Defense Style Questionnaire 60 (DSQ-60).pdf',
    'Psychotherapy Using_the_Defense_Mechanism_Rating_Scales.pdf',
    'Defenses in Everyday Life.pdf',
]

# 중간 우선순위 — 시간 되면
MEDIUM = [
    'psychodynamic-psychiatry-in-clinical-practice-fifth-edition-9781585624430-1585624438_compress.pdf',
    'Adaptation_to_life.pdf',
    'Validation-of-the-Korean-Version-of-the-Vaillant-Defense-Mechanism-Rating-Scale.pdf',
    'Defense Style Questionnaire.pdf',
]

# RAG1 (행동→방어기제 매핑) 전용 추가 lit
RAG1 = [
    'DSM-IV-TR.pdf',
    'Exploring-the-Structure-of-Human-Defensive-Responses-from-Judgments-of-Threat-Scenarios.pdf',
    'Intersubjective-Systems-Theorypdf.pdf',
    # 'Scenario-based_defense_mechanism_for_distributed_model_predictive_control.pdf'
    # ↑ control-theory off-topic (제목 함정), psychology 아님 → 제외
]


def extract(pdf_path: Path, out_path: Path) -> tuple[int, float]:
    """returns (page_count, elapsed_sec). skip if exists."""
    if out_path.exists():
        return -1, 0.0
    t0 = time.time()
    pages_text = []
    with pdfplumber.open(pdf_path) as pdf:
        n = len(pdf.pages)
        for i, page in enumerate(pdf.pages):
            try:
                txt = page.extract_text() or ''
                pages_text.append(f'\n\n===== PAGE {i+1} =====\n{txt}')
            except Exception as e:
                pages_text.append(f'\n\n===== PAGE {i+1} (ERROR: {e}) =====')
            if (i + 1) % 25 == 0:
                print(f'    {i+1}/{n} pages ({time.time()-t0:.0f}s)', flush=True)
    out_path.write_text(''.join(pages_text), encoding='utf-8')
    return n, time.time() - t0


def main():
    arg = sys.argv[1] if len(sys.argv) > 1 else 'priority'
    if   arg == 'priority': files = PRIORITY
    elif arg == 'medium'  : files = MEDIUM
    elif arg == 'rag1'    : files = RAG1
    elif arg == 'all'     : files = PRIORITY + MEDIUM + RAG1
    else                  : files = PRIORITY

    print(f'Extracting {len(files)} PDFs → {OUT_DIR}\n')
    total_t0 = time.time()
    for i, fname in enumerate(files):
        pdf = RAW_DIR / fname
        if not pdf.exists():
            print(f'[{i+1}/{len(files)}] MISSING: {fname}')
            continue
        out = OUT_DIR / (pdf.stem + '.txt')
        size_mb = pdf.stat().st_size / 1e6
        print(f'[{i+1}/{len(files)}] {fname} ({size_mb:.1f}MB)')
        try:
            n, sec = extract(pdf, out)
            if n == -1:
                print(f'    skip (already extracted)')
            else:
                print(f'    {n} pages in {sec:.0f}s → {out.name}')
        except Exception as e:
            print(f'    FAIL: {e}')

    print(f'\nDone in {(time.time()-total_t0)/60:.1f} min')


if __name__ == '__main__':
    main()
