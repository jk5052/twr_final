"""
추출된 사례를 방어기제로 분류.
"""

import json
from anthropic import Anthropic

client = Anthropic()

# 데이터 로드
with open('../processed/cases_extracted.json') as f:
    cases = json.load(f)

with open('../processed/defenses_definitions.json') as f:
    defenses = json.load(f)

defense_names = list(defenses.keys())

# 각 사례 분류
for i, case in enumerate(cases):
    print(f"분류 {i+1}/{len(cases)}")
    
    response = client.messages.create(
        model="claude-sonnet-4-5",
        max_tokens=500,
        messages=[{
            "role": "user",
            "content": f"""사례:
상황: {case['situation']}
핵심: {case['key_behavior']}

후보 방어기제: {defense_names}

JSON으로:
{{
  "primary": "회피",
  "secondary": "지성화",
  "confidence": 0.85,
  "reasoning": "..."
}}
"""
        }]
    )
    
    text = response.content[0].text
    try:
        start = text.find('{')
        end = text.rfind('}') + 1
        case['classification'] = json.loads(text[start:end])
    except:
        case['classification'] = None

# 저장
with open('../processed/cases_classified.json', 'w', encoding='utf-8') as f:
    json.dump(cases, f, indent=2, ensure_ascii=False)

print(f"분류 완료")