# explore_poetry_foundation.py
import pandas as pd

print("다운로드 중...")
df = pd.read_parquet("hf://datasets/shahules786/PoetryFoundationData/data/train-00000-of-00001-486832872ed96d17.parquet")

print(f"\n총 시 수: {len(df)}")
print(f"필드: {list(df.columns)}")

# 첫 5편 보기
print("\n=== 첫 5편 ===")
for i in range(5):
    row = df.iloc[i]
    print(f"\n--- {row['poem name']} / {row['author']} ---")
    print(row['content'][:300])  # 처음 300자만
    print("...")

# 작가 다양성
print(f"\n총 작가 수: {df['author'].nunique()}")

# 작가별 시 수
print(f"\n작가별 TOP 20:")
print(df['author'].value_counts().head(20))

# 짧은 시 샘플 (네 게임에 더 맞을 가능성)
df['line_count'] = df['content'].str.count('\n') + 1
df['word_count'] = df['content'].str.split().str.len()

short = df[(df['line_count'] >= 5) & (df['line_count'] <= 25) & (df['word_count'] <= 200)]
print(f"\n짧은 시 (5-25행): {len(short)}편")

# 짧은 시 랜덤 5개
print("\n=== 짧은 시 샘플 5개 ===")
for _, row in short.sample(5, random_state=42).iterrows():
    print(f"\n--- {row['poem name']} / {row['author']} ---")
    print(row['content'])
    print()