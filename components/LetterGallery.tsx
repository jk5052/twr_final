'use client'
import { useEffect, useMemo, useRef, useState } from 'react'
import LetterDetailCard from '@/components/LetterDetailCard'

// Timeline gallery of every active letter. The focused id (from /letter/[id])
// opens initially. Other letters are read-only browse; replies/inbox only fire
// on the focused card. Aesthetic mirrors a museum-style collection timeline.

export interface GalleryLetter {
  id:               string
  letterText:       string
  primaryDefense:   string
  authorPseudonym:  string | null
  source:           'seed' | 'player'
  originPlayerId:   string | null
  blankAnswer:      string | null
  createdAt:        string
  imageUrl:         string | null
}

interface Props {
  letters:    GalleryLetter[]
  focusedId:  string
}

const THUMB_W   = 52
const THUMB_H   = 72
const STRIDE    = 78           // x-spacing between letters
const BANDS     = 5
const BAND_H    = 78
const TOP_PAD   = 96           // header markers + breathing room
const BOT_PAD   = 56
const DOT_COLOR = '#5fa8a3'

function hashStr(s: string): number {
  let h = 0
  for (let i = 0; i < s.length; i++) h = (h * 31 + s.charCodeAt(i)) | 0
  return Math.abs(h)
}
function placeY(id: string): number {
  const h = hashStr(id)
  const band = h % BANDS
  const jitter = ((h >> 8) % 28) - 14
  return TOP_PAD + band * BAND_H + jitter
}

interface DateMarker { x: number; label: string }

export default function LetterGallery({ letters, focusedId }: Props) {
  const [openId, setOpenId] = useState<string | null>(focusedId)
  const scrollRef = useRef<HTMLDivElement | null>(null)

  const { positioned, width, height, markers, dots } = useMemo(() => {
    const sorted = [...letters].sort((a, b) =>
      a.createdAt < b.createdAt ? -1 : a.createdAt > b.createdAt ? 1 : 0)
    const positioned = sorted.map((l, i) => ({
      letter: l,
      x: 80 + i * STRIDE,
      y: placeY(l.id),
    }))
    const w = Math.max(1200, 80 + sorted.length * STRIDE + 80)
    const h = TOP_PAD + BANDS * BAND_H + BOT_PAD
    const markers: DateMarker[] = []
    let lastKey = ''
    for (const p of positioned) {
      const d = new Date(p.letter.createdAt)
      const key = `${d.getUTCFullYear()}-${d.getUTCMonth()}`
      if (key !== lastKey) {
        markers.push({
          x: p.x,
          label: d.toLocaleDateString('en-US', { month: 'short', year: 'numeric' }),
        })
        lastKey = key
      }
    }
    const dots = Array.from({ length: Math.max(20, sorted.length) }, (_, i) => {
      const h0 = hashStr(`dot-${i}`)
      return {
        x: 60 + ((h0 % 1000) / 1000) * (w - 120),
        y: TOP_PAD + ((h0 >> 10) % 1000) / 1000 * (BANDS * BAND_H),
      }
    })
    return { positioned, width: w, height: h, markers, dots }
  }, [letters])

  useEffect(() => {
    if (!scrollRef.current) return
    const target = positioned.find((p) => p.letter.id === focusedId)
    if (!target) return
    const cont = scrollRef.current
    const x = target.x - cont.clientWidth / 2 + THUMB_W / 2
    cont.scrollTo({ left: Math.max(0, x), behavior: 'instant' as ScrollBehavior })
  }, [positioned, focusedId])

  const open = openId ? letters.find((l) => l.id === openId) ?? null : null

  return (
    <main className="min-h-screen w-full bg-[#f6f1e8] text-stone-800
      flex flex-col" style={{ fontFamily: 'Geist, ui-sans-serif, system-ui' }}>
      <header className="px-8 pt-10 pb-4 flex items-baseline gap-6">
        <p className="text-stone-400 text-[10px] tracking-[0.35em] uppercase">the white room</p>
        <p className="text-stone-500 text-[11px] tracking-[0.2em]">a collection of letters</p>
        <p className="ml-auto text-stone-400 text-[10px] tracking-[0.25em]">
          {letters.length} entries · click any to read
        </p>
      </header>

      <div ref={scrollRef}
        className="flex-1 overflow-x-auto overflow-y-hidden cursor-grab active:cursor-grabbing
          [scrollbar-width:thin]">
        <div className="relative" style={{ width, height }}>
          <div className="absolute left-0 right-0 top-12 h-px bg-stone-300/60" />
          {markers.map((m) => (
            <div key={m.x} className="absolute" style={{ left: m.x, top: 36 }}>
              <p className="text-stone-400 text-[10px] tracking-[0.2em] uppercase">{m.label}</p>
              <div className="w-px h-3 bg-stone-300 mt-1" />
            </div>
          ))}

          {dots.map((d, i) => (
            <span key={i} className="absolute rounded-full pointer-events-none"
              style={{ left: d.x, top: d.y, width: 4, height: 4, background: DOT_COLOR, opacity: 0.55 }} />
          ))}

          {positioned.map(({ letter, x, y }) => (
            <Thumbnail key={letter.id} letter={letter} x={x} y={y}
              focused={letter.id === focusedId}
              onOpen={() => setOpenId(letter.id)} />
          ))}
        </div>
      </div>

      <footer className="px-8 py-4 text-stone-400 text-[10px] tracking-[0.3em] uppercase border-t border-stone-200">
        the white room · letters never sent
      </footer>

      {open && (
        <LetterDetailCard
          letter={open}
          isFocused={open.id === focusedId}
          onClose={() => setOpenId(null)}
        />
      )}
    </main>
  )
}

interface ThumbProps {
  letter:   GalleryLetter
  x:        number
  y:        number
  focused:  boolean
  onOpen:   () => void
}

function Thumbnail({ letter, x, y, focused, onOpen }: ThumbProps) {
  const ring = focused ? 'ring-1 ring-stone-700/70 shadow-[0_0_0_3px_rgba(95,168,163,0.25)]' : ''
  const hover = 'hover:scale-[1.06] hover:z-20 hover:shadow-md transition-all duration-150'
  const common = `absolute cursor-pointer ${ring} ${hover}`
  const style = { left: x, top: y, width: THUMB_W, height: THUMB_H }
  if (letter.imageUrl) {
    return (
      <button onClick={onOpen} className={common} style={style} aria-label="open letter">
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img src={letter.imageUrl} alt=""
          className="w-full h-full object-cover bg-stone-200" loading="lazy" />
      </button>
    )
  }
  const snippet = letter.letterText.split(/\s+/).slice(0, 6).join(' ')
  return (
    <button onClick={onOpen} className={`${common} bg-[#ede4d2] border border-stone-300/70
      flex flex-col p-1 text-left`} style={style} aria-label="open letter">
      <span className="text-stone-400 text-[5px] tracking-[0.2em] uppercase leading-none">
        {letter.source}
      </span>
      <span className="mt-1 text-stone-700 text-[6.5px] leading-[1.25] line-clamp-5
        font-serif italic">
        {snippet}…
      </span>
    </button>
  )
}
