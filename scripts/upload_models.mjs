// Uploads twr/public/models/*.glb to a public Supabase Storage bucket so the
// production build can fetch them via a CDN URL (set NEXT_PUBLIC_MODELS_BASE_URL).
// Run from twr/:
//   node --env-file=.env.local scripts/upload_models.mjs
import { createClient } from '@supabase/supabase-js'
import { readFile, readdir, stat } from 'node:fs/promises'
import { join, basename } from 'node:path'
import { fileURLToPath } from 'node:url'

const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL
const SECRET       = process.env.SUPABASE_SECRET_KEY
if (!SUPABASE_URL || !SECRET) {
  console.error('missing NEXT_PUBLIC_SUPABASE_URL or SUPABASE_SECRET_KEY')
  process.exit(1)
}

const BUCKET = 'models'
const sup = createClient(SUPABASE_URL, SECRET, { auth: { persistSession: false } })

const here = fileURLToPath(new URL('.', import.meta.url))
const dir  = join(here, '..', 'public', 'models')

async function ensureBucket() {
  const { data: list, error } = await sup.storage.listBuckets()
  if (error) throw error
  if (list.some((b) => b.name === BUCKET)) {
    console.log(`bucket "${BUCKET}" already exists`)
    return
  }
  // 1GB per-file is the Supabase free-tier upload cap; r4.glb is 857MB so we
  // bump fileSizeLimit accordingly. Bucket is public for direct CDN reads.
  const { error: cErr } = await sup.storage.createBucket(BUCKET, {
    public: true,
    fileSizeLimit: '1GB',
  })
  if (cErr) throw cErr
  console.log(`created bucket "${BUCKET}" (public)`)
}

async function uploadOne(filename) {
  const full = join(dir, filename)
  const { size } = await stat(full)
  const buf = await readFile(full)
  console.log(`→ uploading ${filename} (${(size / 1e6).toFixed(1)} MB)…`)
  const t0 = Date.now()
  const { error } = await sup.storage.from(BUCKET).upload(filename, buf, {
    contentType: 'model/gltf-binary',
    upsert: true,
  })
  if (error) throw error
  const dt = ((Date.now() - t0) / 1000).toFixed(1)
  const { data: pub } = sup.storage.from(BUCKET).getPublicUrl(filename)
  console.log(`  ✓ ${dt}s  ${pub.publicUrl}`)
}

async function main() {
  await ensureBucket()
  const files = (await readdir(dir)).filter((f) => f.endsWith('.glb'))
  if (files.length === 0) { console.log('no .glb files found in', dir); return }
  console.log(`found ${files.length} .glb files in ${dir}\n`)
  for (const f of files) {
    try { await uploadOne(f) }
    catch (e) { console.error(`  ✗ ${f}: ${e.message}`) }
  }
  const baseUrl = `${SUPABASE_URL}/storage/v1/object/public/${BUCKET}`
  console.log(`\nNEXT_PUBLIC_MODELS_BASE_URL=${baseUrl}`)
  console.log('\nset that in twr/.env.local AND in Vercel project env vars.')
}

main().catch((e) => { console.error(e); process.exit(1) })
