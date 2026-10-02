'use client'
import { useEffect, useMemo, useRef, useState } from 'react'
import LetterDetailCard from '@/components/LetterDetailCard'

// Infinity dome — letters mapped onto a sphere using CSS 3D, wrapping the
// viewer 360° around the Y axis and ~±50° vertically. Drag to look around.
// The dome auto-rotates while idle so the archive feels alive, and each
// letter repeats many times across the dome so even a small set fills
// the entire sphere — an echo of the unsent. Edges fade to black via a
// radial mask, evoking an archive room receding into darkness.

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

interface Props { letters: GalleryLetter[]; focusedId: string }

const COLS         = 90                     // full 360° wrap, no seam
const ROWS         = 21                     // ±~50° vertical pitch
const CELL_W       = 56
const CELL_H       = 76
const RADIUS       = 950
const COL_ANG      = (Math.PI * 2) / COLS   // ≈ 0.0698 rad
const ROW_ANG      = 0.085
const SENS_X       = 0.0028
const SENS_Y       = 0.0024
const X_LIMIT      = 0.85                   // ±48° pitch clamp
const AUTO_ROT_PER_MS = (Math.PI * 2) / 240_000   // 1 turn / 4 min

function gcd(a: number, b: number): number {
  return b === 0 ? a : gcd(b, a % b)
}

interface Placed {
  letter: GalleryLetter
  theta:  number
  phi:    number
  prime:  boolean
}

export default function LetterGallery({ letters, focusedId }: Props) {
  const [openId, setOpenId] = useState<string | null>(focusedId)
  const [dragging, setDragging] = useState(false)

  const layout: Placed[] = useMemo(() => {
    const sorted = [...letters].sort((a, b) =>
      a.createdAt < b.createdAt ? -1 : a.createdAt > b.createdAt ? 1 : 0)
    const N = sorted.length
    if (N === 0) return []

    // Stride coprime with N spreads each letter's instances around the dome
    // instead of clustering them in adjacent cells. Row offset breaks vertical stripes.
    let stride = 1
    for (const s of [11, 13, 17, 7, 19, 23, 5, 3]) {
      if (s < N && gcd(s, N) === 1) { stride = s; break }
    }

    const placed: Placed[] = []
    const seen = new Set<string>()
    for (let i = 0; i < COLS * ROWS; i++) {
      const row = Math.floor(i / COLS)
      const col = i % COLS
      const idx = ((i * stride) + row * 3) % N
      const letter = sorted[idx]
      const prime = !seen.has(letter.id)
      if (prime) seen.add(letter.id)
      placed.push({
        letter,
        // theta wraps fully around the cylinder: range [-π, +π).
        theta: ((col * COL_ANG) + Math.PI) % (Math.PI * 2) - Math.PI,
        phi:   (row - (ROWS - 1) / 2) * ROW_ANG,
        prime,
      })
    }
    return placed
  }, [letters])

  const focused = layout.find((p) => p.prime && p.letter.id === focusedId)
              ?? layout.find((p) => p.letter.id === focusedId)
              ?? layout[0]
  const initRotY = focused ? -focused.theta : 0
  const initRotX = focused ? -focused.phi   : 0

  // ref-driven transform: rAF mutates DOM directly so 1500+ cells don't trigger
  // React re-renders every frame. State drives only cursor/dragging class.
  const innerRef = useRef<HTMLDivElement>(null)
  const rotYRef  = useRef(initRotY)
  const rotXRef  = useRef(initRotX)
  const dragRef  = useRef<{ x: number; y: number; rotY: number; rotX: number } | null>(null)
  const idleRef  = useRef(true)
  useEffect(() => { idleRef.current = !dragging && !openId }, [dragging, openId])

  useEffect(() => {
    let last = performance.now()
    let raf  = 0
    const tick = (now: number) => {
      const dt = now - last
      last = now
      if (idleRef.current) rotYRef.current += dt * AUTO_ROT_PER_MS
      if (innerRef.current) {
        innerRef.current.style.transform =
          `translate(-50%, -50%) rotateX(${rotXRef.current}rad) rotateY(${rotYRef.current}rad)`
      }
      raf = requestAnimationFrame(tick)
    }
    raf = requestAnimationFrame(tick)
    return () => cancelAnimationFrame(raf)
  }, [])

  const onPointerDown = (e: React.PointerEvent) => {
    (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId)
    dragRef.current = { x: e.clientX, y: e.clientY, rotY: rotYRef.current, rotX: rotXRef.current }
    setDragging(true)
  }
  const onPointerMove = (e: React.PointerEvent) => {
    if (!dragRef.current) return
    const dx = e.clientX - dragRef.current.x
    const dy = e.clientY - dragRef.current.y
    rotYRef.current = dragRef.current.rotY + dx * SENS_X
    const nextX = dragRef.current.rotX - dy * SENS_Y
    rotXRef.current = Math.max(-X_LIMIT, Math.min(X_LIMIT, nextX))
  }
  const onPointerUp = (e: React.PointerEvent) => {
    const el = e.currentTarget as HTMLElement
    if (el.hasPointerCapture(e.pointerId)) el.releasePointerCapture(e.pointerId)
    dragRef.current = null
    setDragging(false)
  }

  const open = openId ? layout.find((p) => p.letter.id === openId)?.letter ?? null : null

  return (
    <main className="relative w-screen h-screen overflow-hidden bg-black text-white
      font-sans select-none">
      <div className="absolute top-0 left-0 right-0 z-20 px-8 pt-8 pb-3
        flex items-baseline gap-6 pointer-events-none">
        <p className="font-serif italic text-white/85 text-2xl leading-none">the white room</p>
        <p className="text-white/45 text-[10px] tracking-[0.35em] uppercase">letters never sent</p>
        <p className="ml-auto text-white/35 text-[10px] tracking-[0.25em] uppercase">
          {letters.length} letters · {layout.length} echoes · drag to look · click to read
        </p>
      </div>

      <div
        className="absolute inset-0 cursor-grab active:cursor-grabbing"
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={onPointerUp}
        onPointerCancel={onPointerUp}
        style={{ perspective: '1200px', perspectiveOrigin: '50% 50%' }}
      >
        <div
          ref={innerRef}
          className="absolute left-1/2 top-1/2 will-change-transform"
          style={{
            transformStyle: 'preserve-3d',
            transform: `translate(-50%, -50%) rotateX(${initRotX}rad) rotateY(${initRotY}rad)`,
          }}
        >
          {layout.map(({ letter, theta, phi, prime }, i) => {
            const cosPhi = Math.cos(phi)
            const x = Math.sin(theta) * cosPhi * RADIUS
            const y = Math.sin(phi) * RADIUS
            const z = -Math.cos(theta) * cosPhi * RADIUS
            return (
              <Cell key={i} letter={letter}
                focused={prime && letter.id === focusedId}
                echo={!prime}
                onOpen={() => setOpenId(letter.id)}
                style={{
                  transform: `translate3d(${x}px, ${y}px, ${z}px) rotateY(${-theta}rad) rotateX(${phi}rad)`,
                }} />
            )
          })}
        </div>

        {/* warm center light + heavy radial vignette to black at edges */}
        <div className="absolute inset-0 pointer-events-none"
          style={{
            background:
              'radial-gradient(ellipse at center, rgba(255,240,220,0.06) 0%, transparent 18%, rgba(0,0,0,0.55) 60%, rgba(0,0,0,0.95) 88%, #000 100%)',
          }} />
      </div>

      <div className="absolute bottom-3 left-0 right-0 z-20 text-center
        text-white/30 text-[9px] tracking-[0.4em] uppercase pointer-events-none">
        the white room · an archive of unsent words
      </div>

      {open && (
        <LetterDetailCard
          letter={open}
          isFocused={open.id === focusedId}
          onClose={() => setOpenId(null)} />
      )}
    </main>
  )
}


interface CellProps {
  letter:  GalleryLetter
  focused: boolean
  echo:    boolean
  onOpen:  () => void
  style:   React.CSSProperties
}

function Cell({ letter, focused, echo, onOpen, style }: CellProps) {
  // Replicate output URLs expire after ~1h, so older rows now 404. Fall back to
  // the text snippet on load failure so the dome stays clean (no broken-image icons).
  const [imgFailed, setImgFailed] = useState(false)
  const showImage = !!letter.imageUrl && !imgFailed
  const ring = focused
    ? 'ring-1 ring-white/85 shadow-[0_0_28px_rgba(255,255,255,0.45)]'
    : echo
    ? 'ring-1 ring-white/[0.06] hover:ring-white/30'
    : 'ring-1 ring-white/15 hover:ring-white/55'
  const base = `absolute cursor-pointer transition-shadow duration-200 ${ring}`
  const opacity = focused ? 1 : echo ? 0.72 : 1
  const box  = {
    width: CELL_W, height: CELL_H,
    left:  -CELL_W / 2, top: -CELL_H / 2,
    backfaceVisibility: 'hidden' as const,
    opacity,
    ...style,
  }
  if (showImage) {
    return (
      <button onClick={(e) => { e.stopPropagation(); onOpen() }} className={base}
        style={box} aria-label="open letter">
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img src={letter.imageUrl!} alt=""
          className="w-full h-full object-cover bg-stone-900" loading="lazy"
          onError={() => setImgFailed(true)} />
      </button>
    )
  }
  const snippet = letter.letterText.split(/\s+/).slice(0, 5).join(' ')
  return (
    <button onClick={(e) => { e.stopPropagation(); onOpen() }}
      className={`${base} bg-[#0e0e0e] border border-white/10 flex flex-col p-1 text-left`}
      style={box} aria-label="open letter">
      <span className="text-white/30 text-[5px] tracking-[0.25em] uppercase leading-none">
        {letter.source}
      </span>
      <span className="mt-1 text-white/75 text-[6px] leading-[1.3] line-clamp-5
        font-serif italic">
        {snippet}…
      </span>
    </button>
  )
}
