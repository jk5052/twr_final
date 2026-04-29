import requests
import json
import os
from anthropic import Anthropic
from dotenv import load_dotenv

load_dotenv('../../../.env')

client = Anthropic()

def get_wiki_plot(title):
    """위키 줄거리"""
    url = "https://en.wikipedia.org/w/api.php"
    headers = {'User-Agent': 'TWR-Research/1.0 (educational project)'}
    params = {
        'action': 'query',
        'prop': 'extracts',
        'explaintext': True,
        'titles': title,
        'format': 'json'
    }
    response = requests.get(url, params=params, headers=headers)
    pages = response.json()['query']['pages']
    page = list(pages.values())[0]
    return page.get('extract', None)


def analyze_defenses(film_title, plot):
    """Claude로 방어기제 분석"""
    
    defenses = [
        "회피", "부인", "투사", "지성화", "고립", "해리",
        "합리화", "승화", "퇴행", "억압", "반동형성", "전위",
        "이상화", "평가절하", "취소", "동일시", "행동화",
        "수동공격", "이타주의", "유머"
    ]
    
    prompt = f"""다음은 영화 "{film_title}"의 위키피디아 줄거리입니다.

[줄거리]
{plot}

[지시]
이 영화의 주인공이 보이는 *주요 방어기제*를 줄거리에서 찾을 수 있는 만큼만 식별하세요.
줄거리에 없는 것 추측하지 마세요.

가능한 방어기제: {defenses}

[중요 - key_universal_experience 작성 톤]
다음 예시 톤을 *정확히* 따라야 합니다. 너무 시적이거나 과하면 실패입니다.

예시 (Blue Jasmine, 부인):
---
어떤 것이 이미 끝났다는 걸
눈치채는 순간이 있습니다.

근데 이상하게
조금만 더 예전 방식으로 행동하면
되돌릴 수 있을 것 같은 느낌이 남아요.

그럴 때
바로 인정하는 편인가요,
아니면
조금 더 이전 세계 안에 머물러보는 편인가요?

왜요?
---

규칙:
- 짧은 줄, 줄바꿈 적극 사용
- "있습니다", "있어요" 같은 일상 어조
- "황혼", "거울 속 낯선 얼굴" 같은 시적 클리셰 *금지*
- 보편 경험 (작품 안 본 사람도 자기 경험으로 들어옴)
- 두 자리 제시 ("바로 ~ 편인가요, 아니면 ~ 편인가요?")
- 마지막에 "왜요?"
- 6-12줄 정도

[출력 - JSON만]
{{
  "primary_defense": "...",
  "evidence_primary": "줄거리에서 직접 인용",
  "secondary_defense": "..." or null,
  "evidence_secondary": "..." or null,
  "key_universal_experience": "위 톤을 정확히 따른 자극",
  "confidence": 0-1
}}
"""
    
    response = client.messages.create(
        model="claude-sonnet-4-5",
        max_tokens=1500,
        messages=[{"role": "user", "content": prompt}]
    )
    
    text = response.content[0].text
    start = text.find('{')
    end = text.rfind('}') + 1
    return json.loads(text[start:end])


# 테스트
print("Blue Jasmine 줄거리 받기...")
plot = get_wiki_plot("Blue Jasmine")
print(f"줄거리 {len(plot)}자\n")

print("Claude 분석 중...")
result = analyze_defenses("Blue Jasmine", plot)

print("\n" + "=" * 50)
print(json.dumps(result, indent=2, ensure_ascii=False))
print("=" * 50)