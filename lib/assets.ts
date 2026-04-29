// Resolves model paths to either local /public assets (dev) or an external CDN
// (production). The literal '/models/<name>.glb' string remains the stable
// identity used by Room.tsx lookup tables (CAMERA_OVERRIDES, LIGHT_BOOST, etc.);
// only the URL handed to useGLTF / fetch is rewritten.
//
// Configure via NEXT_PUBLIC_MODELS_BASE_URL, e.g.
//   https://<project>.supabase.co/storage/v1/object/public/models
// Trailing slash is tolerated. Empty/unset = local /models passthrough.

const RAW_BASE = process.env.NEXT_PUBLIC_MODELS_BASE_URL ?? ''
const BASE = RAW_BASE.replace(/\/+$/, '')

if (typeof window !== 'undefined') {
  console.log('[assets] NEXT_PUBLIC_MODELS_BASE_URL =', BASE || '(empty → local /models)')
}

export function resolveModelUrl(path: string): string {
  if (!BASE) return path
  // path is like '/models/r1.glb' — strip the local prefix and append filename
  const filename = path.replace(/^\/models\//, '')
  const out = `${BASE}/${filename}`
  if (typeof window !== 'undefined') console.log('[assets] resolve', path, '→', out)
  return out
}
