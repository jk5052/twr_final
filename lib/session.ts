// Session/player identity for narrative_logs.
//   player_id  : 동일 브라우저의 replay를 묶기 위한 영속 익명 ID (localStorage)
//   session_id : 한 플레이 세션 = 한 탭. 새 탭/새 창은 새 세션. (sessionStorage)
// 둘 다 UUID v4. SSR-safe — window 없으면 빈 문자열 반환 (호출부는 client 컴포넌트에서 사용).

const PLAYER_KEY  = 'twr.playerId'
const SESSION_KEY = 'twr.sessionId'

function uuid(): string {
  if (typeof crypto !== 'undefined' && 'randomUUID' in crypto) {
    return crypto.randomUUID()
  }
  // RFC4122 v4 fallback (older browsers)
  return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, (c) => {
    const r = (Math.random() * 16) | 0
    const v = c === 'x' ? r : (r & 0x3) | 0x8
    return v.toString(16)
  })
}

export function getPlayerId(): string {
  if (typeof window === 'undefined') return ''
  let id = window.localStorage.getItem(PLAYER_KEY)
  if (!id) {
    id = uuid()
    window.localStorage.setItem(PLAYER_KEY, id)
  }
  return id
}

export function getSessionId(): string {
  if (typeof window === 'undefined') return ''
  let id = window.sessionStorage.getItem(SESSION_KEY)
  if (!id) {
    id = uuid()
    window.sessionStorage.setItem(SESSION_KEY, id)
  }
  return id
}

export function resetSessionId(): string {
  if (typeof window === 'undefined') return ''
  const id = uuid()
  window.sessionStorage.setItem(SESSION_KEY, id)
  return id
}
