import { supabase } from './supabase'

/**
 * Markings a set's leaders draw on its charts. Stored as vector data on top of the untouched
 * library PDF, per set + song + page. Coordinates are fractions of the page (x of its width,
 * y of its height), so marks stay in place at any zoom or screen size.
 */
export type Pt = [number, number]

export interface StrokeMark {
  id: string
  t: 'pen' | 'hl'
  c: string
  /** Line width as a fraction of the page width. */
  w: number
  p: Pt[]
}

export interface TextMark {
  id: string
  t: 'text'
  c: string
  /** Font size as a fraction of the page width. */
  s: number
  /** Top-left corner of the text. */
  x: number
  y: number
  text: string
}

export type Mark = StrokeMark | TextMark
export type MarksByPage = Record<string, Mark[]>
export type MarkTool = 'pen' | 'hl' | 'text' | 'erase'

export const PEN_COLORS = ['#d92d20', '#1d4ed8', '#111111', '#15803d']
export const HL_COLORS = ['#ffd400', '#5ee07a', '#ff7ad1']
export const PEN_WIDTH = 0.0045
export const HL_WIDTH = 0.024
export const TEXT_SIZE = 0.034
export const LINE_HEIGHT = 1.2

export const markKey = (songId: string, page: number) => `${songId}:${page}`
export const newMarkId = () => Math.random().toString(36).slice(2, 10)

export function marksFromRows(rows: { song_id: string; page: number; items: Mark[] }[] | undefined): MarksByPage {
  const out: MarksByPage = {}
  for (const r of rows ?? []) if (r.items?.length) out[markKey(r.song_id, r.page)] = r.items
  return out
}

export function marksToRows(marks: MarksByPage) {
  return Object.entries(marks)
    .filter(([, items]) => items.length)
    .map(([key, items]) => {
      const i = key.lastIndexOf(':')
      return { song_id: key.slice(0, i), page: Number(key.slice(i + 1)), items }
    })
}

/** Smooth SVG path through the points (quadratic curves via midpoints), in a w × h box. */
export function strokePath(points: Pt[], w: number, h: number): string {
  if (points.length === 0) return ''
  const P = points.map(([x, y]) => [x * w, y * h])
  const f = (n: number) => n.toFixed(1)
  if (P.length === 1) return `M${f(P[0][0])} ${f(P[0][1])}L${f(P[0][0] + 0.01)} ${f(P[0][1])}`
  let d = `M${f(P[0][0])} ${f(P[0][1])}`
  for (let i = 1; i < P.length - 1; i++) {
    const mx = (P[i][0] + P[i + 1][0]) / 2
    const my = (P[i][1] + P[i + 1][1]) / 2
    d += `Q${f(P[i][0])} ${f(P[i][1])} ${f(mx)} ${f(my)}`
  }
  const last = P[P.length - 1]
  return d + `L${f(last[0])} ${f(last[1])}`
}

/** Rounds coordinates and drops points too close together, to keep saved strokes small. */
export function tidyPoints(points: Pt[], minDist = 0.0025): Pt[] {
  const out: Pt[] = []
  for (const [x, y] of points) {
    const prev = out[out.length - 1]
    if (prev && Math.hypot(x - prev[0], y - prev[1]) < minDist) continue
    out.push([Math.round(x * 10000) / 10000, Math.round(y * 10000) / 10000])
  }
  const last = points[points.length - 1]
  const kept = out[out.length - 1]
  if (last && kept && (last[0] !== kept[0] || last[1] !== kept[1]) && out.length > 1) out.push(last)
  return out
}

export function textLines(m: TextMark) {
  return m.text.split('\n')
}

/** Approximate box of a text mark, in page fractions. */
export function textBox(m: TextMark, aspect: number) {
  const lines = textLines(m)
  const longest = Math.max(1, ...lines.map((l) => l.length))
  return { x: m.x, y: m.y, w: longest * m.s * 0.62, h: (lines.length * m.s * LINE_HEIGHT) / aspect }
}

/** Whether page point (x, y) touches the mark. `aspect` is page height / width. */
export function hitsMark(m: Mark, x: number, y: number, aspect: number, tol = 0.018): boolean {
  if (m.t === 'text') {
    const b = textBox(m, aspect)
    const pad = tol
    return x >= b.x - pad && x <= b.x + b.w + pad && y >= b.y - pad / aspect && y <= b.y + b.h + pad / aspect
  }
  // Measure in page-width units so x and y distances are comparable.
  const reach = tol + m.w / 2
  const pts = m.p
  for (let i = 0; i < pts.length; i++) {
    const [ax, ay] = pts[i]
    const [bx, by] = pts[Math.min(i + 1, pts.length - 1)]
    if (distToSegment(x, y * aspect, ax, ay * aspect, bx, by * aspect) <= reach) return true
  }
  return false
}

function distToSegment(px: number, py: number, ax: number, ay: number, bx: number, by: number) {
  const dx = bx - ax
  const dy = by - ay
  const len2 = dx * dx + dy * dy
  const t = len2 ? Math.max(0, Math.min(1, ((px - ax) * dx + (py - ay) * dy) / len2)) : 0
  return Math.hypot(px - (ax + t * dx), py - (ay + t * dy))
}

export type SaveStatus = 'idle' | 'saving' | 'saved' | 'error'

/**
 * Saves changed pages shortly after the last edit. Failed saves stay queued and are retried on the
 * next edit, when the connection comes back, or when the viewer closes.
 */
export function createMarkSaver(eventId: string, onStatus: (s: SaveStatus) => void) {
  const dirty = new Map<string, { songId: string; page: number; marks: Mark[] }>()
  let timer: ReturnType<typeof setTimeout> | undefined
  let running: Promise<void> | null = null

  async function flushNow() {
    clearTimeout(timer)
    timer = undefined
    if (running) await running
    if (!dirty.size) return
    onStatus('saving')
    running = (async () => {
      let failed = false
      for (const [key, { songId, page, marks }] of [...dirty]) {
        const { error } = marks.length
          ? await supabase.from('set_annotations').upsert(
              { event_id: eventId, song_id: songId, page, items: marks, updated_at: new Date().toISOString() },
              { onConflict: 'event_id,song_id,page' },
            )
          : await supabase.from('set_annotations').delete().match({ event_id: eventId, song_id: songId, page })
        if (error) failed = true
        // Only clear if nothing newer was queued for this page meanwhile.
        else if (dirty.get(key)?.marks === marks) dirty.delete(key)
      }
      onStatus(failed ? 'error' : dirty.size ? 'saving' : 'saved')
    })()
    await running
    running = null
    if (dirty.size && !timer) timer = setTimeout(flushNow, 5000)
  }

  const onOnline = () => flushNow()
  window.addEventListener('online', onOnline)

  return {
    queue(songId: string, page: number, marks: Mark[]) {
      dirty.set(markKey(songId, page), { songId, page, marks })
      onStatus('saving')
      clearTimeout(timer)
      timer = setTimeout(flushNow, 700)
    },
    flush: flushNow,
    dispose() {
      window.removeEventListener('online', onOnline)
      void flushNow()
    },
  }
}
