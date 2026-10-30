import { useEffect, useState } from 'react'
import { chartUrl, supabase } from './supabase'

export interface LyricHit {
  id: string
  snippet: string
}

const letters = (q: string) => q.toLowerCase().replace(/[^\p{L}\p{N}]/gu, '')

/** Same rule as the database: the query's letters in order, anything non-letter allowed in between. */
export function lyricPattern(query: string): RegExp | null {
  const l = letters(query)
  if (l.length < 4) return null
  return new RegExp([...l].map((c) => c.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')).join('[^\\p{L}\\p{N}]*'), 'iu')
}

/** Splits a snippet into [before, match, after] for highlighting. */
export function splitSnippet(snippet: string, query: string): [string, string, string] {
  const text = snippet.replace(/\s*\n\s*/g, ' / ')
  const m = lyricPattern(query)?.exec(text)
  if (!m) return [text, '', '']
  return [text.slice(0, m.index), m[0], text.slice(m.index + m[0].length)]
}

/**
 * Searches the charts' words a moment after typing stops (title matches show instantly;
 * these follow). Needs at least 4 letters.
 */
export function useLyricSearch(query: string) {
  const [state, setState] = useState<{ query: string; hits: LyricHit[]; searching: boolean }>({
    query: '',
    hits: [],
    searching: false,
  })

  useEffect(() => {
    const q = query.trim()
    if (letters(q).length < 4) {
      setState({ query: q, hits: [], searching: false })
      return
    }
    // Clear the previous search's hits right away so they never show under a new query.
    setState({ query: q, hits: [], searching: true })
    let cancelled = false
    const t = setTimeout(async () => {
      const { data } = await supabase.rpc('search_lyrics', { p_query: q })
      if (!cancelled) setState({ query: q, hits: (data ?? []) as LyricHit[], searching: false })
    }, 350)
    return () => {
      cancelled = true
      clearTimeout(t)
    }
  }, [query])

  return state
}

let indexing: Promise<void> | null = null

/**
 * Reads the words of charts that haven't been read yet (older uploads) and stores them for
 * lyrics search. Runs quietly in the background, a couple of charts at a time; only needs to
 * happen once per chart, for everyone.
 */
export function indexMissingLyrics(onProgress: (done: number, total: number) => void): Promise<void> {
  if (indexing) return indexing
  const conn = (navigator as Navigator & { connection?: { saveData?: boolean } }).connection
  if (conn?.saveData) return Promise.resolve()
  indexing = (async () => {
    const { data } = await supabase
      .from('songs')
      .select('id, pdf_path')
      .is('lyrics_indexed_at', null)
      .not('pdf_path', 'is', null)
      .limit(1000)
    const todo = (data ?? []) as { id: string; pdf_path: string }[]
    if (!todo.length) return
    const { readChartBytes } = await import('./pdfDetails')
    let done = 0
    onProgress(0, todo.length)
    const queue = [...todo]
    async function worker() {
      for (let s = queue.shift(); s; s = queue.shift()) {
        try {
          const res = await fetch(chartUrl(s.pdf_path))
          if (res.ok) {
            let lyrics: string | null = null
            try {
              lyrics = (await readChartBytes(new Uint8Array(await res.arrayBuffer()))).lyrics
            } catch {
              /* unreadable PDF: mark it read so it isn't retried every time */
            }
            await supabase
              .from('songs')
              .update({ lyrics, lyrics_indexed_at: new Date().toISOString() })
              .eq('id', s.id)
          }
        } catch {
          /* offline or flaky: try again next time */
        }
        onProgress(++done, todo.length)
      }
    }
    await Promise.all([worker(), worker()])
  })().finally(() => {
    indexing = null
  })
  return indexing
}
