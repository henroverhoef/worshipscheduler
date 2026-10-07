export function formatDate(date: string | null, opts: Intl.DateTimeFormatOptions = {}) {
  if (!date) return ''
  // Dates are stored as plain YYYY-MM-DD; parse as local so they don't shift a day.
  const [y, m, d] = date.split('-').map(Number)
  return new Date(y, m - 1, d).toLocaleDateString(undefined, {
    weekday: 'short',
    day: 'numeric',
    month: 'short',
    year: 'numeric',
    ...opts,
  })
}

export function todayIso() {
  const now = new Date()
  const pad = (n: number) => String(n).padStart(2, '0')
  return `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}`
}

export function shareUrl(shareId: string) {
  return `${window.location.origin}/s/${shareId}`
}

/**
 * Guess a title and key from a chart file name, e.g. "Way Maker - E.pdf", "Goodness of God (Ab).pdf",
 * "Agnus Dei-chords-A.pdf" or "graves-into-gardens-E-2.pdf".
 */
export function parseChartFileName(fileName: string): { title: string; key: string | null } {
  let base = fileName.replace(/\.pdf$/i, '').replace(/_+/g, ' ').replace(/\s+/g, ' ').trim()
  let key: string | null = null
  const m = base.match(/(?:\s*[-–]\s*|\s?\(|\s?\[)([A-G](?:#|b)?m?)[)\]]?(?:-\d+)?$/)
  if (m) {
    key = m[1]
    base = base.slice(0, m.index).trim()
  }
  base = base.replace(/[-\s]+chords$/i, '').replace(/\s*[-–]\s*$/, '')
  // Lowercase slugs like "how-he-loves" become "How He Loves".
  if (base === base.toLowerCase()) {
    base = base.replace(/-/g, ' ').replace(/\b[a-z]/g, (c) => c.toUpperCase())
  }
  return { title: base || fileName, key }
}

/** Share text for a set, e.g. "Sunday PM – Sun, 11 Oct 2026 · 18:00". */
export function shareText(set: { name: string; event_date: string | null; start_time: string | null }) {
  const when = [formatDate(set.event_date), set.start_time].filter(Boolean).join(' · ')
  return when ? `${set.name} – ${when}` : set.name
}

export async function shareLink(title: string, url: string, text?: string): Promise<'shared' | 'copied' | 'failed'> {
  if (navigator.share) {
    try {
      await navigator.share({ title, text, url })
      return 'shared'
    } catch (e) {
      if ((e as Error).name === 'AbortError') return 'failed'
    }
  }
  try {
    await navigator.clipboard.writeText(text ? `${text}\n${url}` : url)
    return 'copied'
  } catch {
    window.prompt('Copy this link:', url)
    return 'copied'
  }
}
