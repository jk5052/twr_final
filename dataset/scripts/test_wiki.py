import requests

def get_wiki_plot(title):
    """위키피디아에서 영화 줄거리 가져오기"""
    url = "https://en.wikipedia.org/w/api.php"
    
    # User-Agent 추가 (Wikipedia 요구)
    headers = {
        'User-Agent': 'TWR-Research/1.0 (educational project)'
    }
    
    params = {
        'action': 'query',
        'prop': 'extracts',
        'explaintext': True,
        'titles': title,
        'format': 'json'
    }
    
    response = requests.get(url, params=params, headers=headers)
    
    # 응답 확인
    if response.status_code != 200:
        print(f"HTTP 에러: {response.status_code}")
        print(f"응답 내용: {response.text[:500]}")
        return None
    
    try:
        data = response.json()
    except Exception as e:
        print(f"JSON 파싱 실패: {e}")
        print(f"응답 (앞 500자): {response.text[:500]}")
        return None
    
    pages = data['query']['pages']
    page = list(pages.values())[0]
    
    if 'extract' not in page:
        print("페이지 없음 또는 내용 없음")
        return None
    
    return page['extract']

# 테스트
print("Blue Jasmine 줄거리 가져오는 중...\n")
plot = get_wiki_plot("Blue Jasmine")

if plot:
    print(f"성공. 길이: {len(plot)}자\n")
    print("=" * 50)
    print(plot[:2000])
    print("=" * 50)
else:
    print("실패")