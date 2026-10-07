import type { SharedEvent } from './types'

// Remembers sets a viewer opened, so they can find them again and read them offline.
const LIST_KEY = 'ws.recentSets'
const EVENT_KEY = (shareId: string) => `ws.set.${shareId}`

export interface RecentSet {
  share_id: string
  name: string
  event_date: string | null
  opened_at: number
}

function read<T>(key: string, fallback: T): T {
  try {
    const raw = localStorage.getItem(key)
    return raw ? (JSON.parse(raw) as T) : fallback
  } catch {
    return fallback
  }
}

function write(key: string, value: unknown) {
  try {
    localStorage.setItem(key, JSON.stringify(value))
  } catch {
    /* storage full or blocked: offline copy is a convenience only */
  }
}

export function recentSets(): RecentSet[] {
  return read<RecentSet[]>(LIST_KEY, [])
}

export function rememberSet(event: SharedEvent) {
  write(EVENT_KEY(event.share_id), event)
  const list = recentSets().filter((r) => r.share_id !== event.share_id)
  list.unshift({ share_id: event.share_id, name: event.name, event_date: event.event_date, opened_at: Date.now() })
  const kept = list.slice(0, 20)
  for (const dropped of list.slice(20)) {
    try {
      localStorage.removeItem(EVENT_KEY(dropped.share_id))
    } catch {
      /* ignore */
    }
  }
  write(LIST_KEY, kept)
}

export function cachedSet(shareId: string): SharedEvent | null {
  return read<SharedEvent | null>(EVENT_KEY(shareId), null)
}

export function forgetSet(shareId: string) {
  write(LIST_KEY, recentSets().filter((r) => r.share_id !== shareId))
  try {
    localStorage.removeItem(EVENT_KEY(shareId))
  } catch {
    /* ignore */
  }
}
