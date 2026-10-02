"""
임상 책 PDF에서 사례 자동 추출.
필요: dataset/raw/ 안에 PDF 파일들
"""

import os
import json
import pdfplumber
from anthropic import Anthropic

client = Anthropic()

def extract_text(pdf_path):
    with pdfplumber.open(pdf_path) as pdf:
        return "\n".join([p.extract_text() or "" for p in pdf.pages])

def extract_cases_from_chunk(text_chunk, source):
    response = client.messages.create(
        model="claude-sonnet-4-5",
        max_tokens=4000,
        messages=[{
            "role": "user",
            "content": f"""다음 임상 책에서 환자 사례를 모두 추출하세요.

각 사례 JSON:
{{
  "patient_pseudonym": "...",
  "situation": "...",
  "key_behavior": "...",
  "key_quote": "...",
  "source": "{source}"
}}

JSON 배열로만 답. 사례 없으면 [].

텍스트:
{text_chunk}
"""
        }]
    )
    
    text = response.content[0].text
    try:
        start = text.find('[')
        end = text.rfind(']') + 1
        return json.loads(text[start:end])
    except:
        return []

def process_pdf(pdf_path):
    print(f"\n처리: {pdf_path}")
    text = extract_text(pdf_path)
    chunks = [text[i:i+50000] for i in range(0, len(text), 50000)]
    
    cases = []
    for i, chunk in enumerate(chunks):
        print(f"  청크 {i+1}/{len(chunks)}")
        chunk_cases = extract_cases_from_chunk(chunk, os.path.basename(pdf_path))
        cases.extend(chunk_cases)
    
    print(f"  추출: {len(cases)}개")
    return cases

# 모든 PDF 처리
all_cases = []
raw_dir = '../raw'

for filename in os.listdir(raw_dir):
    if filename.endswith('.pdf'):
        pdf_path = os.path.join(raw_dir, filename)
        cases = process_pdf(pdf_path)
        all_cases.extend(cases)

# 저장
os.makedirs('../processed', exist_ok=True)
with open('../processed/cases_extracted.json', 'w', encoding='utf-8') as f:
    json.dump(all_cases, f, indent=2, ensure_ascii=False)

print(f"\n총 추출: {len(all_cases)}개 사례")