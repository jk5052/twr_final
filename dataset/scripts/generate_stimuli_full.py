"""
445편 전체 자극 생성 (영어).
중간 저장 + 재시작 가능 + 에러 처리 강화.
"""

import pandas as pd
import requests
import json
import os
import time
from anthropic import Anthropic
from dotenv import load_dotenv

load_dotenv('../../../.env')
client = Anthropic()

WIKI_HEADERS = {'User-Agent': 'TWR-Research/1.0 (jk5052@columbia.edu)'}

EXAMPLES = """
[Example 1 - Blue Jasmine, Denial]
There are moments when
you notice something has already ended.

But somehow,
if you just kept acting the old way,
it feels like things might be reversible.

In those moments,
do you tend to acknowledge it right away,
or
linger a little longer in the world before?

Why?

[Example 2 - Black Swan, Projection]
Sometimes a person hasn't done anything wrong,
but they still bother you.

When they do well, your space feels smaller.
When they're quiet, it feels like they're hiding something.

There are two possibilities:
That person really is unsettling you.
You're already unsettled, and reading it onto them.

In moments like this, which do you tend to believe first?
Do you put your guard up,
or hold off on your reaction for a moment?

Why?

[Example 3 - Whiplash, Sublimation]
When the mind gets crowded,
some people reach for people.
Others reach for repetition.

Rhythm. Work. Order.

When you're shaken,
do you turn toward people,
or toward work?

Why?
"""


def fetch_wiki_page(title):
    """단순 페이지 fetch - 에러 시 빈 문자열"""
    try:
        time.sleep(1.0)
        url = "https://en.wikipedia.org/w/api.php"
        params = {
            'action': 'query',
            'prop': 'extracts',
            'explaintext': True,
            'titles': title,
            'format': 'json'
        }
        response = requests.get(url, params=params, headers=WIKI_HEADERS, timeout=10)
        if response.status_code != 200:
            return ''
        data = response.json()
        pages = data.get('query', {}).get('pages', {})
        if not pages:
            return ''
        page = list(pages.values())[0]
        return page.get('extract', '')
    except Exception as e:
        print(f"    Wiki fetch error: {e}")
        time.sleep(2)
        return ''


def search_wiki(query):
    """검색 API - 에러 시 빈 리스트"""
    try:
        time.sleep(1.0)
        url = "https://en.wikipedia.org/w/api.php"
        params = {
            'action': 'query',
            'list': 'search',
            'srsearch': query,
            'format': 'json',
            'srlimit': 3
        }
        response = requests.get(url, params=params, headers=WIKI_HEADERS, timeout=10)
        if response.status_code != 200:
            return []
        results = response.json().get('query', {}).get('search', [])
        return [r['title'] for r in results]
    except Exception as e:
        print(f"    Wiki search error: {e}")
        time.sleep(2)
        return []


def get_wiki_plot(title):
    """모호 페이지 처리 + 검색 fallback"""
    extract = fetch_wiki_page(title)
    if extract and len(extract) > 300 and 'may refer to' not in extract:
        return extract
    
    for suffix in [' (film)', ' (2016 film)', ' (2003 film)', ' (1999 film)', 
                   ' (2000 film)', ' (2010 film)', ' (2014 film)', 
                   ' (2017 film)', ' (2019 film)', ' (1976 film)', ' (1980 film)']:
        extract = fetch_wiki_page(title + suffix)
        if extract and len(extract) > 300 and 'may refer to' not in extract:
            return extract
    
    candidates = search_wiki(f'{title} film')
    for candidate in candidates:
        if 'film' in candidate.lower() or '(' in candidate:
            extract = fetch_wiki_page(candidate)
            if extract and len(extract) > 300 and 'may refer to' not in extract:
                return extract
    
    return ''


def generate_stimulus(film, defense, plot):
    prompt = f"""Based on this film's plot, write a defense mechanism stimulus in English.

[Film]
{film}

[Defense Mechanism]
{defense}

[Plot]
{plot[:5000]}

[Tone Examples - Match exactly]
{EXAMPLES}

[Rules - Must Follow]
1. Short lines, frequent line breaks
2. Conversational, gentle tone (avoid academic or poetic register)
3. NO poetic clichés ("twilight," "mirror's stranger," "fate," etc.)
4. Universal experience (someone who hasn't seen the film should still enter it)
5. Present two positions ("do you tend to ___, or ___?")
6. End with "Why?" or similar light question
7. 6-12 lines
8. NO film title, character names, or specific plot events
9. Only the universal experience extracted from the plot

[Output - JSON only]
{{
  "stimulus": "stimulus text in English",
  "evidence_from_plot": "which part of plot it came from",
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


# 데이터 로드
df = pd.read_csv('../processed/film_index_cleaned.csv')
total = len(df)
print(f"Total {total} films to process\n")

# 중간 저장 (재시작 가능)
output_path = '../processed/stimuli_full.json'

results = []
processed_films = set()
if os.path.exists(output_path):
    with open(output_path, 'r', encoding='utf-8') as f:
        results = json.load(f)
    processed_films = {(r['film'], r['defense']) for r in results}
    print(f"Loaded {len(results)} previous results. Continuing.\n")

skipped_no_wiki = []
skipped_error = []

for i, (_, row) in enumerate(df.iterrows()):
    film_full = row['Film']
    defense = row['Defense mechanism']
    
    # 이미 처리된 건 skip
    if (film_full, defense) in processed_films:
        continue
    
    film = film_full.split(' / ')[0].strip().replace('*', '').strip()
    
    print(f"[{i+1}/{total}] {film} - {defense}")
    
    # Wiki
    plot = get_wiki_plot(film)
    if not plot:
        print(f"  No wiki found, skipping")
        skipped_no_wiki.append(film_full)
        continue
    
    # Generate
    try:
        result = generate_stimulus(film, defense, plot)
        result['film'] = film_full
        result['defense'] = defense
        results.append(result)
        print(f"  Done (confidence: {result.get('confidence', 0)})")
        
        # 매 10편마다 중간 저장
        if len(results) % 10 == 0:
            with open(output_path, 'w', encoding='utf-8') as f:
                json.dump(results, f, indent=2, ensure_ascii=False)
            print(f"  [Saved {len(results)} so far]")
        
        # Rate limit 방지
        time.sleep(2.0)
        
    except Exception as e:
        print(f"  Error: {e}")
        skipped_error.append((film_full, str(e)))
        continue

# 최종 저장
with open(output_path, 'w', encoding='utf-8') as f:
    json.dump(results, f, indent=2, ensure_ascii=False)

print(f"\n{'='*50}")
print(f"Total generated: {len(results)} stimuli")
print(f"Skipped (no wiki): {len(skipped_no_wiki)}")
print(f"Skipped (error): {len(skipped_error)}")
print(f"Saved to: {output_path}")

# 실패 로그
if skipped_no_wiki or skipped_error:
    log_path = '../processed/stimuli_skipped.json'
    with open(log_path, 'w', encoding='utf-8') as f:
        json.dump({
            'no_wiki': skipped_no_wiki,
            'errors': skipped_error
        }, f, indent=2, ensure_ascii=False)
    print(f"Skip log: {log_path}")