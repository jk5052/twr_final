"""
방어기제별 검색용 텍스트 만들고 임베딩.
"""

import json
import os
from openai import OpenAI

client = OpenAI(api_key=os.getenv('OPENAI_API_KEY'))

with open('../processed/rag1_defenses.json') as f:
    rag1 = json.load(f)

for defense_name, data in rag1.items():
    print(f"임베딩: {defense_name}")
    
    # 검색용 텍스트 만들기 (시그널 위주)
    search_text = f"""
{defense_name}: {data['definition']}

행동: {' '.join(data.get('behavioral_signals', []))}
언어: {' '.join(data.get('linguistic_signals', []))}
서사: {' '.join(data.get('narrative_patterns', []))}
"""
    
    # OpenAI 임베딩 호출
    response = client.embeddings.create(
        model="text-embedding-3-small",
        input=search_text
    )
    
    data['search_text'] = search_text
    data['embedding'] = response.data[0].embedding

# 저장
with open('../processed/rag1_embedded.json', 'w', encoding='utf-8') as f:
    json.dump(rag1, f, indent=2, ensure_ascii=False)

print("임베딩 완료")