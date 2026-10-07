import { createClient } from '@supabase/supabase-js'

// Publishable (anon) credentials: safe to ship in the browser; access is enforced by row level security.
const url = import.meta.env.VITE_SUPABASE_URL ?? 'https://ydisjxcetvvatokvucvr.supabase.co'
const key = import.meta.env.VITE_SUPABASE_KEY ?? 'sb_publishable_gyQ8uUHHtW5zqt5EAwHAuQ_L4DhkKWu'

export const supabase = createClient(url, key)

export const CHARTS_BUCKET = 'charts'

export function chartUrl(path: string) {
  return supabase.storage.from(CHARTS_BUCKET).getPublicUrl(path).data.publicUrl
}
