// Anthropic API 의 strict JSON 파서가 lone UTF-16 surrogate (D800-DFFF unpaired)
// 를 reject ("no low surrogate in string"). 두 단계로 방어:
//   1) source string 정화 — 모든 입력 text 를 stripLoneSurrogates 통과
//   2) post-stringify 정화 — JSON.stringify 가 lone surrogate 를 \uXXXX literal
//      escape 로 그대로 출력하므로 (RFC 8259 strict parser 에서는 escape 된 lone
//      surrogate 도 invalid), final body 문자열에서도 escape 형태를 제거

// 짝 없는 surrogate code unit 을 string 에서 제거.
export function stripLoneSurrogates(s: string): string {
  let out = ''
  for (let i = 0; i < s.length; i++) {
    const c = s.charCodeAt(i)
    if (c >= 0xD800 && c <= 0xDBFF) {
      const n = s.charCodeAt(i + 1)
      if (n >= 0xDC00 && n <= 0xDFFF) { out += s[i] + s[i + 1]; i++ }
      // else: drop lone high
    } else if (c >= 0xDC00 && c <= 0xDFFF) {
      // drop lone low
    } else {
      out += s[i]
    }
  }
  return out
}

// JSON.stringify 결과 문자열에서 lone surrogate escape 를 제거.
// paired \uD8XX\uDCXX 는 보호 마커로 격리한 뒤 단독 escape 만 strip.
export function stripLoneSurrogateEscapes(s: string): string {
  const HI = /\\u(D[89ABab][0-9A-Fa-f]{2})\\u(D[C-Fc-f][0-9A-Fa-f]{2})/g
  const protectedStr = s.replace(HI, '\u0001$1$2\u0002')
  const cleaned = protectedStr
    .replace(/\\uD[89ABab][0-9A-Fa-f]{2}/g, '')
    .replace(/\\uD[C-Fc-f][0-9A-Fa-f]{2}/g, '')
  return cleaned.replace(/\u0001(D[89ABab][0-9A-Fa-f]{2})(D[C-Fc-f][0-9A-Fa-f]{2})\u0002/g, '\\u$1\\u$2')
}

// Anthropic 으로 보낼 body 를 한 번에 stringify + sanitize.
export function buildAnthropicBody(payload: unknown): string {
  return stripLoneSurrogateEscapes(JSON.stringify(payload))
}
