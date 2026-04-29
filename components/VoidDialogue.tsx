'use client'
import { useEffect, useRef, useState } from 'react'
import { getSessionId } from '@/lib/session'

interface ChatMsg { role: 'user' | 'assistant'; content: string }
interface ConvResponse {
  message: string
  turn_count: number
  kind: 'question' | 'closing'
  profile?: { defense: string; weight: number }[]
  films_used?: string[]
}

interface VoidDialogueProps {
  onComplete: () => void
}

export default function VoidDialogue({ onComplete }: VoidDialogueProps) {
  const [messages, setMessages] = useState<ChatMsg[]>([])
  const [input, setInput] = useState('')
  const [sending, setSending] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [closed, setClosed] = useState(false)
  const startedRef = useRef(false)
  const scrollRef = useRef<HTMLDivElement | null>(null)

  // 첫 턴 — voice 의 오프닝 시나리오 fetch (마운트 1회)
  useEffect(() => {
    if (startedRef.current) return
    startedRef.current = true
    void send([])
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  // 새 메시지 도착 시 자동 스크롤
  useEffect(() => {
    const el = scrollRef.current
    if (el) el.scrollTop = el.scrollHeight
  }, [messages, sending])

  async function send(history: ChatMsg[]) {
    setSending(true)
    setError(null)
    try {
      const r = await fetch('/api/conversation', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ session_id: getSessionId(), messages: history }),
      })
      if (!r.ok) {
        setError((await r.text()).slice(0, 200))
        return
      }
      const j = await r.json() as ConvResponse
      setMessages([...history, { role: 'assistant', content: j.message }])
      if (j.kind === 'closing') setClosed(true)
    } catch (e) {
      setError(String(e).slice(0, 200))
    } finally {
      setSending(false)
    }
  }

  const onSubmit = () => {
    const text = input.trim()
    if (!text || sending || closed) return
    const next: ChatMsg[] = [...messages, { role: 'user', content: text }]
    setMessages(next)
    setInput('')
    void send(next)
  }

  const onKey = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault()
      onSubmit()
    }
  }

  return (
    <div className="absolute inset-0 z-30 flex flex-col items-center justify-end pb-10 px-6 pointer-events-none">
      {/* 흰 Void 배경에 흰 텍스트가 묻히지 않도록 하단 어두운 그라데이션 scrim.
          상단은 완전 투명 → 하단으로 갈수록 어두워져 채팅 영역만 가독성 확보. */}
      <div className="absolute inset-x-0 bottom-0 h-2/3 pointer-events-none
        bg-gradient-to-t from-black/85 via-black/55 to-transparent" />

      {/* 메시지 thread */}
      <div
        ref={scrollRef}
        className="pointer-events-auto w-full max-w-2xl flex-1 overflow-y-auto
          flex flex-col gap-5 py-10 mb-6 scroll-smooth relative"
        style={{ maskImage: 'linear-gradient(to bottom, transparent 0%, black 12%, black 100%)' }}
      >
        {messages.map((m, i) => (
          <div
            key={i}
            className={`max-w-[85%] text-base leading-relaxed
              animate-[fadeIn_500ms_ease-out]
              [text-shadow:0_1px_4px_rgba(0,0,0,0.85)]
              ${m.role === 'assistant'
                ? 'self-start text-white'
                : 'self-end text-white/70 text-right'}`}
          >
            <p className="whitespace-pre-wrap">{m.content}</p>
          </div>
        ))}
        {sending && (
          <p className="self-start text-white/60 text-xs tracking-widest animate-pulse
            [text-shadow:0_1px_4px_rgba(0,0,0,0.85)]">…</p>
        )}
        {error && (
          <p className="self-start text-red-300 text-xs tracking-wider
            [text-shadow:0_1px_4px_rgba(0,0,0,0.85)]">failed: {error}</p>
        )}
      </div>

      {/* 입력 영역 / closing 버튼 */}
      <div className="pointer-events-auto w-full max-w-2xl relative">
        {closed ? (
          <div className="flex justify-center">
            <button
              onClick={onComplete}
              className="text-white hover:text-white text-xs
                tracking-[0.3em] uppercase px-6 py-3 border border-white/40
                hover:border-white bg-black/50 backdrop-blur-sm transition-colors"
            >leave the room ▸</button>
          </div>
        ) : (
          <div className="flex items-end gap-3">
            <textarea
              value={input}
              onChange={(e) => setInput(e.target.value)}
              onKeyDown={onKey}
              placeholder={messages.length === 0 ? '…' : 'type your answer. (Enter to send, Shift+Enter for newline)'}
              rows={2}
              disabled={sending}
              className="flex-1 bg-black/60 backdrop-blur-sm border border-white/30
                text-white text-sm leading-relaxed p-3 outline-none
                focus:border-white/70 transition-colors resize-none
                placeholder:text-white/40 disabled:opacity-40"
            />
            <button
              onClick={onSubmit}
              disabled={sending || !input.trim()}
              className="text-white hover:text-white text-xs
                tracking-[0.3em] uppercase px-4 py-3 border border-white/40
                hover:border-white bg-black/50 backdrop-blur-sm transition-colors
                disabled:opacity-30 disabled:cursor-not-allowed"
            >send</button>
          </div>
        )}
      </div>
    </div>
  )
}
