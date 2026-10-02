"""
20개 방어기제 정의.
이 파일은 직접 작성. 임상 자료 읽으며 채움.
"""

import json

defenses = {
    "회피": {
        "name_en": "Avoidance",
        "vaillant_level": "neurotic",
        "definition": "불안한 상황으로부터 물리적·심리적으로 거리를 둠",
        "behavioral_signals": [
            # 채워넣기
        ],
        "linguistic_signals": [
            # 채워넣기
        ],
        "narrative_patterns": [
            # 채워넣기
        ],
        "differentiation": {
            "vs_부인": "회피는 인지+거리. 부인은 인지 거부",
            # 더 추가
        }
    },
    
    "부인": {
        "name_en": "Denial",
        "vaillant_level": "psychotic",
        "definition": "...",
        "behavioral_signals": [],
        "linguistic_signals": [],
        "narrative_patterns": [],
        "differentiation": {}
    },
    
    # 18개 더 (지금 비워둬도 됨, 나중에 채움)
}

# 저장
with open('../processed/defenses_definitions.json', 'w', encoding='utf-8') as f:
    json.dump(defenses, f, indent=2, ensure_ascii=False)

print(f"저장: {len(defenses)}개 방어기제")