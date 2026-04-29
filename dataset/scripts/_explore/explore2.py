# explore2.py
from datasets import load_dataset

ds = load_dataset("biglam/gutenberg-poetry-corpus")

# 중간 부분 샘플
print("중간 부분 (100,000번째 근처):")
for i in range(100000, 100015):
    print(f"[{i}] {ds['train'][i]['line']}")

print("\n\n랜덤 샘플 20개:")
import random
random.seed(42)
for i in random.sample(range(len(ds['train'])), 20):
    print(f"[{i}] {ds['train'][i]['line']}")