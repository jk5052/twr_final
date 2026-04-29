'use client'
import { Document, Page, Text, View, Image, StyleSheet } from '@react-pdf/renderer'
import type { TalismanData } from '@/components/TalismanPDF'

// Talisman label set — Brother VC500W with CZ-1005 (50mm continuous roll).
//   page 1 — oracle (image + name + framing)
//   page 2 — matched poem (compact) + reply + tiny QR
// Two physical labels emerge per print job (auto-cut between pages).

// 50 × 76 mm in PDF points (1pt = 1/72in, 25.4mm = 1in).
const W = 141.73   // 50mm
const H = 215.43   // 76mm

const PAPER = '#f4ede1'
const INK   = '#1a1a1a'
const DIM   = '#7c6e58'
const FAINT = '#9a8c75'

const styles = StyleSheet.create({
  page: {
    backgroundColor: PAPER,
    padding: 8,
    fontFamily: 'Helvetica',
    color: INK,
    flexDirection: 'column',
  },
  oracleFrame: {
    flexGrow: 1,
    borderWidth: 0.4,
    borderColor: DIM,
    padding: 4,
    flexDirection: 'column',
    alignItems: 'center',
    justifyContent: 'flex-start',
  },
  oracleImageBox: {
    width: '100%',
    height: 130,
    backgroundColor: PAPER,
    alignItems: 'center',
    justifyContent: 'center',
  },
  oracleImage: { width: '100%', height: '100%', objectFit: 'contain' },
  oracleRule: { width: 16, height: 0.4, backgroundColor: DIM, marginTop: 8, marginBottom: 5 },
  oracleTitle: {
    fontSize: 7, color: INK, fontFamily: 'Times-Roman',
    textTransform: 'uppercase', letterSpacing: 2, textAlign: 'center',
  },
  oracleSubtitle: {
    fontSize: 4.5, color: DIM, fontFamily: 'Times-Italic',
    marginTop: 4, textAlign: 'center', lineHeight: 1.4,
    paddingHorizontal: 4,
  },

  poemHeader: { flexDirection: 'column', alignItems: 'center', marginBottom: 5 },
  poemTitle: {
    fontSize: 6.5, color: INK, fontFamily: 'Times-Roman',
    textTransform: 'uppercase', letterSpacing: 1.5, textAlign: 'center',
  },
  poemAuthor: {
    fontSize: 4.5, color: DIM, fontFamily: 'Times-Italic',
    marginTop: 2, textAlign: 'center',
  },
  poemRule: {
    width: 14, height: 0.4, backgroundColor: DIM,
    marginTop: 4, marginBottom: 5, alignSelf: 'center',
  },
  poemBody: {
    fontSize: 4.5, color: '#3a342c', fontFamily: 'Times-Roman',
    lineHeight: 1.4, textAlign: 'center', paddingHorizontal: 2,
  },
  replyLabel: {
    fontSize: 3.5, color: FAINT, textTransform: 'uppercase', letterSpacing: 1,
    marginTop: 6, textAlign: 'center',
  },
  reply: {
    fontSize: 4.5, color: INK, fontFamily: 'Times-Italic',
    marginTop: 2, lineHeight: 1.4, textAlign: 'center', paddingHorizontal: 4,
  },
  replySilent: { fontSize: 8, color: FAINT, marginTop: 2, textAlign: 'center' },
  spacer: { flexGrow: 1 },
  bottomRow: {
    flexDirection: 'row', alignItems: 'flex-end',
    justifyContent: 'space-between', marginTop: 4,
  },
  bottomLeft: { flexDirection: 'column', flexShrink: 1, paddingRight: 4 },
  brand: {
    fontSize: 3.5, color: DIM, textTransform: 'uppercase', letterSpacing: 1,
  },
  qr: { width: 42, height: 42 },
})

function OracleLabel({ data }: { data: TalismanData }) {
  const title = (data.defenseName ?? data.defenseFraming ?? 'the talisman').trim()
  return (
    <Page size={[W, H]} style={styles.page}>
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

function PoemLabel({ data }: { data: TalismanData }) {
  // Cap to keep it on one 50×76mm label; longer texts read poorly anyway.
  const poem  = (data.poem ?? '').slice(0, 280)
  const reply = (data.replyText ?? '').slice(0, 200)
  return (
    <Page size={[W, H]} style={styles.page}>
      {(data.poemTitle || poem) && (
        <View style={styles.poemHeader}>
          {data.poemTitle && <Text style={styles.poemTitle}>{data.poemTitle}</Text>}
          {data.poemAuthor && <Text style={styles.poemAuthor}>— {data.poemAuthor}</Text>}
          <View style={styles.poemRule} />
        </View>
      )}
      {poem && <Text style={styles.poemBody}>{poem}</Text>}
      {data.replyText && (
        <>
          <Text style={styles.replyLabel}>your reply</Text>
          {data.replyText === '\u00b7'
            ? <Text style={styles.replySilent}>{'\u00b7'}</Text>
            : <Text style={styles.reply}>{reply}</Text>}
        </>
      )}
      <View style={styles.spacer} />
      <View style={styles.bottomRow}>
        <View style={styles.bottomLeft}>
          <Text style={styles.brand}>the white room</Text>
        </View>
        {data.qrDataUrl && <Image src={data.qrDataUrl} style={styles.qr} />}
      </View>
    </Page>
  )
}

export default function TalismanLabelPDF({ data }: { data: TalismanData }) {
  return (
    <Document>
      <OracleLabel data={data} />
      <PoemLabel data={data} />
    </Document>
  )
}
