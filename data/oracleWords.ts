// Pre-curated 오라클 단어 뱅크 — choice 후 잠깐 띄우는 evocative phrases.
// LLM 호출 없음, 즉시 랜덤 픽. playtest 단계용.
// 카테고리는 분류 도구가 아니라 의미 분포를 다양하게 유지하기 위한 파티션.

export const ORACLE_WORDS: Record<string, readonly string[]> = {
  time: [
    'the long pause', 'thirteen seconds', 'a borrowed hour', 'almost', 'not yet',
    'after midnight', 'the slow return', 'the second time', 'unmarked', 'still',
  ],
  space: [
    'the next room', 'a closed window', 'no exit', 'the corner', 'beneath',
    'the threshold', 'between rooms', 'a small interior', 'the hallway', 'edge',
  ],
  weather: [
    'fog', 'the dry season', 'low pressure', 'hailstone', 'a clear sky',
    'the first cold', 'monsoon', 'static air', 'a single cloud', 'salt rain',
  ],
  body: [
    'an unsteady hand', 'the held breath', 'shoulder turned', 'a quiet pulse',
    'open palms', 'closed eyes', 'the nape', 'standing still', 'a half-step back', 'lean forward',
  ],
  object: [
    'obsidian', 'a cracked cup', 'the same coat', 'an empty frame', 'old paper',
    'a borrowed key', 'a folded note', 'the last lamp', 'small mirror', 'thread',
  ],
  feeling: [
    'something unfinished', 'a private joke', 'almost forgiven', 'the wrong relief',
    'too patient', 'a faint pride', 'restless', 'tender', 'underneath', 'almost calm',
  ],
  motion: [
    'the long walk back', 'a slow exhale', 'a quiet refusal', 'the first step',
    'circling', 'turning away', 'looking once', 'reaching past', 'sitting down', 'staying',
  ],
  fragment: [
    'as if to say', 'and then nothing', 'or perhaps', 'something like that',
    "I'll come back to it", 'and yet', 'so it goes', 'in any case', 'maybe later', 'almost true',
  ],
}

const ALL = Object.values(ORACLE_WORDS).flat()

export function pickOracleWords(n = 3): string[] {
  const pool = [...ALL]
  const out: string[] = []
  for (let i = 0; i < n && pool.length > 0; i++) {
    const idx = Math.floor(Math.random() * pool.length)
    out.push(pool[idx])
    pool.splice(idx, 1)
  }
  return out
}
