'use client'
import { Document, Page, Text, View, Image, StyleSheet } from '@react-pdf/renderer'

// Talisman card set — two A6 portrait pages (105×148mm).
//   page 1 — own oracle: tarot-style AI image with title-below caption.
//   page 2 — matched poem (title/author/content) + reply + QR + brand.
// Pure presentational; CardOverlay assembles props from /api/card-bundle.

export interface TalismanData {
  imageUrl:        string
  defenseFraming:  string | null
  defenseName:     string | null
  replyText:       string | null
  poem:            string | null
  poemTitle:       string | null
  poemAuthor:      string | null
  qrDataUrl:       string | null
  qrUrl:           string | null
}

// shared palette — ivory paper, ink-black, dim sepia accents.
const PAPER = '#f4ede1'
const INK   = '#1a1a1a'
const DIM   = '#7c6e58'
const FAINT = '#9a8c75'

const styles = StyleSheet.create({
  page: {
    backgroundColor: PAPER,
    padding: 18,
    fontFamily: 'Helvetica',
    color: INK,
    flexDirection: 'column',
  },
  // ── card 1 (own oracle) ──────────────────────────────────────────
  oracleFrame: {
    flexGrow: 1,
    borderWidth: 0.6,
    borderColor: DIM,
    padding: 10,
    flexDirection: 'column',
    alignItems: 'center',
    justifyContent: 'flex-start',
  },
  oracleImageBox: {
    width: '100%',
    height: 220,
    backgroundColor: '#ffffff',
    alignItems: 'center',
    justifyContent: 'center',
  },
  oracleImage: {
    width: '100%',
    height: '100%',
    objectFit: 'contain',
  },
  oracleRule: {
    width: 24,
    height: 0.6,
    backgroundColor: DIM,
    marginTop: 18,
    marginBottom: 10,
  },
  oracleTitle: {
    fontSize: 11,
    color: INK,
    fontFamily: 'Times-Roman',
    textTransform: 'uppercase',
    letterSpacing: 3,
    textAlign: 'center',
  },
  oracleSubtitle: {
    fontSize: 7,
    color: DIM,
    fontFamily: 'Times-Italic',
    marginTop: 8,
    textAlign: 'center',
    lineHeight: 1.5,
    paddingHorizontal: 14,
  },
  // ── card 2 (poem) ────────────────────────────────────────────────
  poemHeader: { flexDirection: 'column', alignItems: 'center', marginBottom: 10 },
  poemTitle: {
    fontSize: 11,
    color: INK,
    fontFamily: 'Times-Roman',
    textTransform: 'uppercase',
    letterSpacing: 2,
    textAlign: 'center',
  },
  poemAuthor: {
    fontSize: 7,
    color: DIM,
    fontFamily: 'Times-Italic',
    marginTop: 4,
    textAlign: 'center',
  },
  poemRule: {
    width: 24,
    height: 0.6,
    backgroundColor: DIM,
    marginTop: 8,
    marginBottom: 10,
    alignSelf: 'center',
  },
  poemBody: {
    fontSize: 8,
    color: '#3a342c',
    fontFamily: 'Times-Roman',
    lineHeight: 1.55,
    textAlign: 'center',
    paddingHorizontal: 6,
  },
  replyLabel: {
    fontSize: 5.5,
    color: FAINT,
    textTransform: 'uppercase',
    letterSpacing: 2,
    marginTop: 14,
    textAlign: 'center',
  },
  reply: {
    fontSize: 8,
    color: INK,
    fontFamily: 'Times-Italic',
    marginTop: 4,
    lineHeight: 1.5,
    textAlign: 'center',
    paddingHorizontal: 10,
  },
  replySilent: {
    fontSize: 14,
    color: FAINT,
    marginTop: 6,
    textAlign: 'center',
  },
  spacer: { flexGrow: 1 },
  bottomRow: {
    flexDirection: 'row',
    alignItems: 'flex-end',
    justifyContent: 'space-between',
    marginTop: 10,
  },
  bottomLeft: { flexDirection: 'column', flexShrink: 1, paddingRight: 10 },
  brand: {
    fontSize: 5.5,
    color: DIM,
    textTransform: 'uppercase',
    letterSpacing: 2,
  },
  qrUrlText: { fontSize: 5, color: FAINT, marginTop: 3, maxWidth: 150 },
  qr: { width: 50, height: 50 },
})

function OraclePage({ data }: { data: TalismanData }) {
  // title prefers the named defense (tarot-card feel); falls back to framing.
  const title = (data.defenseName ?? data.defenseFraming ?? 'the talisman').trim()
  return (
    <Page size="A6" style={styles.page}>
      <View style={styles.oracleFrame}>
        <View style={styles.oracleImageBox}>
          <Image src={data.imageUrl} style={styles.oracleImage} />
        </View>
        <View style={styles.oracleRule} />
        <Text style={styles.oracleTitle}>{title}</Text>
        {data.defenseName && data.defenseFraming && (
          <Text style={styles.oracleSubtitle}>{data.defenseFraming}</Text>
        )}
      </View>
    </Page>
  )
}

function PoemPage({ data }: { data: TalismanData }) {
  return (
    <Page size="A6" style={styles.page}>
      {(data.poemTitle || data.poem) && (
        <View style={styles.poemHeader}>
          {data.poemTitle && <Text style={styles.poemTitle}>{data.poemTitle}</Text>}
          {data.poemAuthor && <Text style={styles.poemAuthor}>— {data.poemAuthor}</Text>}
          <View style={styles.poemRule} />
        </View>
      )}

      {data.poem && <Text style={styles.poemBody}>{data.poem}</Text>}

      {data.replyText && (
        <>
          <Text style={styles.replyLabel}>your reply</Text>
          {data.replyText === '\u00b7'
            ? <Text style={styles.replySilent}>{'\u00b7'}</Text>
            : <Text style={styles.reply}>{data.replyText}</Text>}
        </>
      )}

      <View style={styles.spacer} />

      <View style={styles.bottomRow}>
        <View style={styles.bottomLeft}>
          <Text style={styles.brand}>the white room</Text>
          {data.qrUrl && <Text style={styles.qrUrlText}>{data.qrUrl}</Text>}
        </View>
        {data.qrDataUrl && <Image src={data.qrDataUrl} style={styles.qr} />}
      </View>
    </Page>
  )
}

export default function TalismanPDF({ data }: { data: TalismanData }) {
  return (
    <Document>
      <OraclePage data={data} />
      <PoemPage data={data} />
    </Document>
  )
}
