"""
RAG 1을 Supabase에 업로드.
"""

import json
import os
from supabase import create_client

url = os.getenv("SUPABASE_URL")
key = os.getenv("SUPABASE_SERVICE_KEY")
supabase = create_client(url, key)

with open('../processed/rag1_embedded.json') as f:
    rag1 = json.load(f)

records = []
for defense_name, data in rag1.items():
    records.append({
        'name': defense_name,
        'definition': data['definition'],
        'behavioral_signals': data.get('behavioral_signals', []),
        'linguistic_signals': data.get('linguistic_signals', []),
        'narrative_patterns': data.get('narrative_patterns', []),
        'differentiation': data.get('differentiation', {}),
        'clinical_examples': data.get('clinical_examples', []),
        'search_text': data['search_text'],
        'embedding': data['embedding']
    })

result = supabase.table('defenses_rag').insert(records).execute()
print(f"업로드: {len(records)}개")