// Serves a set's share link (/s/:shareId) with the set's name and details in the page's
// meta tags, so WhatsApp & co. show "Sunday PM · Sun 11 Oct" instead of a generic preview.
// The app itself then loads as normal.

const SUPABASE_URL = process.env.VITE_SUPABASE_URL ?? 'https://ydisjxcetvvatokvucvr.supabase.co'
const SUPABASE_KEY = process.env.VITE_SUPABASE_KEY ?? 'sb_publishable_gyQ8uUHHtW5zqt5EAwHAuQ_L4DhkKWu'

interface SharedSet {
  name: string
  event_date: string | null
  start_time: string | null
  location: string | null
  songs: { title: string }[]
}

function escapeHtml(s: string) {
  return s.replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]!)
}

function formatDate(date: string) {
  const [y, m, d] = date.split('-').map(Number)
  return new Date(Date.UTC(y, m - 1, d)).toLocaleDateString('en-GB', {
    weekday: 'short',
    day: 'numeric',
    month: 'short',
    timeZone: 'UTC',
  })
}

async function fetchSet(shareId: string): Promise<SharedSet | null> {
  try {
    const res = await fetch(`${SUPABASE_URL}/rest/v1/rpc/get_shared_event`, {
      method: 'POST',
      headers: { apikey: SUPABASE_KEY, 'Content-Type': 'application/json' },
      body: JSON.stringify({ p_share_id: shareId }),
    })
    return res.ok ? ((await res.json()) as SharedSet | null) : null
  } catch {
    return null
  }
}

export async function GET(request: Request) {
  const url = new URL(request.url)
  const shareId = url.searchParams.get('id') ?? ''
  const [htmlRes, set] = await Promise.all([fetch(new URL('/index.html', url)), fetchSet(shareId)])
  let html = await htmlRes.text()

  if (set) {
    const title = set.name
    const when = [set.event_date && formatDate(set.event_date), set.start_time].filter(Boolean).join(' · ')
    const songs = set.songs.length ? `${set.songs.length} song${set.songs.length === 1 ? '' : 's'}: ${set.songs.map((s) => s.title).join(', ')}` : ''
    const description = [when, set.location, songs].filter(Boolean).join(' · ')
    const image = new URL('/icons/icon-512.png', url).toString()
    const tags = [
      `<meta property="og:title" content="${escapeHtml(title)}" />`,
      `<meta property="og:description" content="${escapeHtml(description)}" />`,
      `<meta property="og:type" content="website" />`,
      `<meta property="og:url" content="${escapeHtml(`${url.origin}/s/${shareId}`)}" />`,
      `<meta property="og:image" content="${escapeHtml(image)}" />`,
      `<meta name="twitter:card" content="summary" />`,
    ].join('\n    ')
    html = html
      .replace(/<title>[^<]*<\/title>/, `<title>${escapeHtml(title)}</title>\n    ${tags}`)
      .replace(/<meta name="description" content="[^"]*" \/>/, `<meta name="description" content="${escapeHtml(description)}" />`)
  }

  return new Response(html, {
    headers: {
      'Content-Type': 'text/html; charset=utf-8',
      // Short cache so renamed sets show their new name in previews quickly.
      'Cache-Control': 'public, max-age=0, s-maxage=60, stale-while-revalidate=300',
    },
  })
}
