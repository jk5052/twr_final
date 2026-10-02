"""
방어기제 정의에 사례 5개씩 붙임.
출력: rag1_defenses.json
"""

import json

with open('../processed/defenses_definitions.json') as f:
    defenses = json.load(f)

with open('../processed/cases_classified.json') as f:
    cases = json.load(f)

# 방어기제별로 사례 매칭
for defense_name in defenses.keys():
    matching = [
        c for c in cases
        if c.get('classification', {}).get('primary') == defense_name
    ]
    matching.sort(
        key=lambda c: c.get('classification', {}).get('confidence', 0),
        reverse=True
    )
    defenses[defense_name]['clinical_examples'] = matching[:5]

# 저장
with open('../processed/rag1_defenses.json', 'w', encoding='utf-8') as f:
    json.dump(defenses, f, indent=2, ensure_ascii=False)

print(f"RAG 1: {len(defenses)}개 방어기제 통합")