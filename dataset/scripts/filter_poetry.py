# filter_poetry.py
import pandas as pd

print("로드 중...")
df = pd.read_parquet("hf://datasets/shahules786/PoetryFoundationData/data/train-00000-of-00001-486832872ed96d17.parquet")

# 1차: 길이 필터
df['line_count'] = df['content'].str.count('\n') + 1
df['word_count'] = df['content'].str.split().str.len()

short = df[
    (df['line_count'] >= 5) & 
    (df['line_count'] <= 25) &
    (df['word_count'] >= 30) &
    (df['word_count'] <= 200)
].copy()

print(f"길이 필터 후: {len(short)}편")

# 2차: 보편 주제 키워드 (게임에 맞는 톤)
universal_themes = [
    # 상실·부재
    'lost', 'gone', 'empty', 'absence', 'leave', 'left', 'forgot',
    # 욕망·기다림
    'longing', 'yearning', 'wait', 'desire', 'hunger',
    # 친밀·거리
    'touch', 'close', 'near', 'far', 'distance', 'between',
    # 시간
    'years', 'memory', 'remember', 'forget', 'still',
    # 공간·신체
    'door', 'window', 'room', 'hand', 'face', 'eyes',
    # 침묵·말
    'silence', 'word', 'speak', 'said', 'tell',
    # 죽음·삶
    'death', 'die', 'live', 'breath',
]

def has_universal_theme(text):
    text_lower = text.lower()
    return any(kw in text_lower for kw in universal_themes)

themed = short[short['content'].apply(has_universal_theme)]
print(f"주제 필터 후: {len(themed)}편")

# 3차: 정치적/시사적 키워드 제외
political_keywords = [
    'race', 'nation', 'flag', 'president', 'war', 
    'capitalism', 'protest', 'revolution', 'politic',
    'america', 'american', 'race'
]

def is_too_political(text):
    text_lower = text.lower()
    return sum(1 for kw in political_keywords if kw in text_lower) >= 2

filtered = themed[~themed['content'].apply(is_too_political)]
print(f"정치 제거 후: {len(filtered)}편")

# 저장
filtered.to_csv('poems_filtered.csv', index=False)
print(f"\n저장: poems_filtered.csv")

# 샘플 5개
print("\n=== 샘플 ===")
for _, row in filtered.sample(5, random_state=7).iterrows():
    print(f"\n--- {row['poem name']} / {row['author']} ---")
    print(row['content'])
    print()