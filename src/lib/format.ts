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

/** Guess a title and key from a chart file name, e.g. "Way Maker - E.pdf" or "Goodness_of_God (Ab).pdf". */
export function parseChartFileName(fileName: string): { title: string; key: string | null } {
  let base = fileName.replace(/\.pdf$/i, '').replace(/[_]+/g, ' ').replace(/\s+/g, ' ').trim()
  let key: string | null = null
  const m = base.match(/(?:\s[-–]\s*|\s?\(|\s?\[)([A-G](?:#|b)?m?)[)\]]?$/)
  if (m) {
    key = m[1]
    base = base.slice(0, m.index).trim()
  }
  return { title: base.replace(/\s*[-–]\s*$/, '') || fileName, key }
}

export async function shareLink(title: string, url: string): Promise<'shared' | 'copied' | 'failed'> {
  if (navigator.share) {
    try {
      await navigator.share({ title, url })
      return 'shared'
    } catch (e) {
      if ((e as Error).name === 'AbortError') return 'failed'
    }
  }
  try {
    await navigator.clipboard.writeText(url)
    return 'copied'
  } catch {
    window.prompt('Copy this link:', url)
    return 'copied'
  }
}
