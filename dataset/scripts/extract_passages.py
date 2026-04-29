from datasets import load_dataset
from collections import defaultdict
import json

print("데이터 로드 중...")
ds = load_dataset("biglam/gutenberg-poetry-corpus")
data = ds['train']
print(f"총 {len(data):,}행")

# 책별로 줄들 모으기
print("\n책별로 묶는 중... (몇 분 걸려)")
books = defaultdict(list)
for row in data:
    books[row['gutenberg_id']].append(row['line'])

print(f"총 {len(books)}권의 책")

# 책별 줄 수 분포 확인
line_counts = [len(lines) for lines in books.values()]
print(f"책당 평균 줄 수: {sum(line_counts)//len(line_counts)}")
print(f"가장 긴 책: {max(line_counts)}줄")
print(f"가장 짧은 책: {min(line_counts)}줄")

# 4줄짜리 구절 추출 (각 책에서 슬라이딩 윈도우)
print("\n4줄짜리 구절 추출 중...")
passages = []
for book_id, lines in books.items():
    # 4줄씩 건너뛰며 윈도우 만들기 (겹침 없이)
    for i in range(0, len(lines) - 3, 4):
        passage_lines = lines[i:i+4]
        passage_text = '\n'.join(passage_lines)
        word_count = len(passage_text.split())
        
        passages.append({
            'book_id': book_id,
            'start_line': i,
            'passage': passage_text,
            'word_count': word_count
        })

print(f"총 추출 구절 수: {len(passages):,}")

# 길이 필터 (15-50 단어 사이만)
filtered = [p for p in passages if 15 <= p['word_count'] <= 50]
print(f"길이 필터 후: {len(filtered):,}")

# JSON으로 저장
output_file = 'passages_raw.json'
with open(output_file, 'w', encoding='utf-8') as f:
    json.dump(filtered, f, ensure_ascii=False, indent=2)

print(f"\n저장 완료: {output_file}")

# 샘플 5개 보기
print("\n=== 샘플 5개 ===")
import random
random.seed(42)
for p in random.sample(filtered, 5):
    print(f"\n--- Book {p['book_id']} ---")
    print(p['passage'])
    print(f"({p['word_count']} 단어)")