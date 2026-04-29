from datasets import load_dataset

print("다운로드 중...")
ds = load_dataset("DanFosing/public-domain-poetry")
print(f"\n총 시 수: {len(ds['train'])}")
print(f"필드: {ds['train'].column_names}")

print("\n첫 시:")
print(ds['train'][0])

print("\n샘플 3개:")
for i in [0, 100, 500]:
    print(f"\n=== 시 {i} ===")
    print(ds['train'][i])