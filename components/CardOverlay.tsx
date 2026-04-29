'use client'
import { useEffect, useRef, useState } from 'react'
import dynamic from 'next/dynamic'
import { getSessionId, getPlayerId } from '@/lib/session'
import TalismanPDF, { type TalismanData } from '@/components/TalismanPDF'
import TalismanLabelPDF from '@/components/TalismanLabelPDF'

// Talisman card phase — final overlay on finalroom.
// Calls /api/card-bundle (idempotent), shows a PDF preview, and offers:
//   - download pdf  (A6 keepsake)
//   - print label   (50mm CZ-1005 label via AirPrint → Brother VC500W)
//   - continue

interface CardOverlayProps {
  onComplete: () => void
}

interface BundleRes {
  image_url:        string
  primary_defense:  string | null
  positive_framing: string | null
  blank_answer:     string | null
  reply_text:       string | null
  card_poem:        string | null
  card_poem_title:  string | null
  card_poem_author: string | null
  qr_url:           string | null
  qr_data_url:      string | null
  shared:           boolean
}

const PDFViewer = dynamic(
  () => import('@react-pdf/renderer').then((m) => m.PDFViewer),
  { ssr: false, loading: () => <div className="text-white/40 text-xs">loading preview…</div> },
)
const PDFDownloadLink = dynamic(
  () => import('@react-pdf/renderer').then((m) => m.PDFDownloadLink),
  { ssr: false },
)
const BlobProvider = dynamic(
  () => import('@react-pdf/renderer').then((m) => m.BlobProvider),
  { ssr: false },
)

export default function CardOverlay({ onComplete }: CardOverlayProps) {
  const [bundle, setBundle] = useState<BundleRes | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const fetchedRef = useRef(false)

  useEffect(() => {
    if (fetchedRef.current) return
    fetchedRef.current = true
    void (async () => {
      try {
        const r = await fetch('/api/card-bundle', {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ session_id: getSessionId(), player_id: getPlayerId() }),
        })
        if (!r.ok) { setError((await r.text()).slice(0, 200)); return }
        setBundle(await r.json() as BundleRes)
      } catch (e) {
        setError(String(e).slice(0, 200))
      } finally {
        setLoading(false)
      }
    })()
  }, [])

  const data: TalismanData | null = bundle
    ? {
        imageUrl:       bundle.image_url,
        defenseFraming: bundle.positive_framing ?? null,
        defenseName:    bundle.primary_defense,
        replyText:      bundle.reply_text,
        poem:           bundle.card_poem,
        poemTitle:      bundle.card_poem_title,
        poemAuthor:     bundle.card_poem_author,
        qrDataUrl:      bundle.qr_data_url,
        qrUrl:          bundle.qr_url,
      }
    : null

  return (
    <div className="absolute inset-0 z-30 flex flex-col items-center justify-center px-6 py-10 pointer-events-none">
      <div className="absolute inset-0 bg-black/75 pointer-events-none" />

      <div className="pointer-events-auto w-full max-w-3xl flex flex-col items-center gap-6 relative">
        {loading && !error && (
          <p className="text-white/60 text-xs tracking-[0.3em] uppercase animate-pulse">
            creating your card…
          </p>
        )}

        {error && (
          <p className="text-red-300/90 text-xs tracking-widest">failed: {error}</p>
        )}

        {data && (
          <>
            <p className="text-white/60 text-[10px] tracking-[0.3em] uppercase">
              your talisman
              {bundle?.shared ? ' · shared' : ' · private'}
            </p>
            <div className="w-full" style={{ aspectRatio: '105/148', maxHeight: '70vh' }}>
              <PDFViewer
                style={{ width: '100%', height: '100%', border: 'none', backgroundColor: '#222' }}
                showToolbar
              >
                <TalismanPDF data={data} />
              </PDFViewer>
            </div>

            <div className="flex items-center gap-3">
              <PDFDownloadLink
                document={<TalismanPDF data={data} />}
                fileName={`twr-talisman-${getSessionId().slice(0, 8)}.pdf`}
                className="text-white text-xs tracking-[0.3em] uppercase
                  px-5 py-3 border border-white/40 hover:border-white
                  bg-black/50 transition-colors"
              >
                {({ loading: dlLoading }) => dlLoading ? 'preparing…' : 'download pdf'}
              </PDFDownloadLink>

              <BlobProvider document={<TalismanLabelPDF data={data} />}>
                {({ url, loading: blobLoading }) => (
                  <PrintLabelButton url={url} loading={blobLoading} />
                )}
              </BlobProvider>

              <button
                onClick={onComplete}
                className="text-white text-xs tracking-[0.3em] uppercase
                  px-5 py-3 border border-white/40 hover:border-white
                  bg-black/50 transition-colors"
              >continue ▸</button>
            </div>
          </>
        )}
      </div>
    </div>
  )
}


// Hidden-iframe print: drops the label PDF blob into an offscreen iframe and
// calls contentWindow.print(), which surfaces the OS print dialog.
// On macOS this picks up AirPrint targets (e.g. Brother VC500W) automatically.
function PrintLabelButton({ url, loading }: { url: string | null; loading: boolean }) {
  const iframeRef = useRef<HTMLIFrameElement | null>(null)
  const [frameReady, setFrameReady] = useState(false)

  useEffect(() => { setFrameReady(false) }, [url])

  const onPrint = () => {
    const win = iframeRef.current?.contentWindow
    if (!win) return
    try { win.focus(); win.print() } catch { /* user can retry */ }
  }

  const disabled = loading || !url || !frameReady
  const label = loading || !url ? 'preparing label…'
              : !frameReady     ? 'loading…'
              :                   'print label'

  return (
    <>
      <button
        onClick={onPrint}
        disabled={disabled}
        className="text-white text-xs tracking-[0.3em] uppercase
          px-5 py-3 border border-white/40 hover:border-white
          bg-black/50 transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
      >{label}</button>
      {url && (
        <iframe
          ref={iframeRef}
          src={url}
          onLoad={() => setFrameReady(true)}
          style={{ position: 'absolute', width: 0, height: 0, border: 0, visibility: 'hidden' }}
          aria-hidden
        />
      )}
    </>
  )
}
