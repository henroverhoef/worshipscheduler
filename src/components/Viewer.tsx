import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState, type MouseEvent } from 'react'
import { loadPdf, type PdfDoc } from '../lib/pdf'
import { chartUrl } from '../lib/supabase'
import type { SetSong } from '../lib/types'

type Fit = 'page' | 'width'

interface Slide {
  songIndex: number
  pageNo: number // 1-based page in its PDF
  pagesInSong: number
  doc: PdfDoc | null
  error?: string
}

interface Props {
  songs: SetSong[]
  startSong?: number
  onClose: () => void
}

function readPref<T extends string>(key: string, fallback: T): T {
  try {
    return (localStorage.getItem(key) as T) || fallback
  } catch {
    return fallback
  }
}
function writePref(key: string, value: string) {
  try {
    localStorage.setItem(key, value)
  } catch {
    /* ignore */
  }
}

/**
 * Music-stand style viewer: every page of every chart in the set laid out in one
 * horizontal strip, so a 3-page and a 2-page chart swipe like a single 5-page book.
 */
export default function Viewer({ songs, startSong = 0, onClose }: Props) {
  const rootRef = useRef<HTMLDivElement>(null)
  const trackRef = useRef<HTMLDivElement>(null)
  const [slides, setSlides] = useState<Slide[] | null>(null)
  const [current, setCurrent] = useState(0)
  const currentRef = useRef(0)
  const [size, setSize] = useState({ w: 0, h: 0 })
  const [chrome, setChrome] = useState(true)
  const [fit, setFit] = useState<Fit>(() => readPref<Fit>('ws.fit', 'page'))
  const [night, setNight] = useState(() => readPref<string>('ws.night', 'off') === 'on')
  const [showSongs, setShowSongs] = useState(false)

  // Load every chart and flatten into one page list (keyed on content so a new array identity doesn't reload).
  const songsKey = songs.map((s) => `${s.id}:${s.pdf_path ?? ''}`).join('|')
  useEffect(() => {
    let cancelled = false
    Promise.all(
      songs.map(async (song, songIndex): Promise<Slide[]> => {
        if (!song.pdf_path) return [{ songIndex, pageNo: 1, pagesInSong: 1, doc: null, error: 'No chart uploaded' }]
        try {
          const doc = await loadPdf(chartUrl(song.pdf_path))
          return Array.from({ length: doc.numPages }, (_, i) => ({
            songIndex,
            pageNo: i + 1,
            pagesInSong: doc.numPages,
            doc,
          }))
        } catch {
          return [{ songIndex, pageNo: 1, pagesInSong: 1, doc: null, error: 'Couldn’t load this chart' }]
        }
      }),
    ).then((perSong) => {
      if (!cancelled) setSlides(perSong.flat())
    })
    return () => {
      cancelled = true
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [songsKey])

  const firstSlideOfSong = useMemo(() => {
    const map = new Map<number, number>()
    slides?.forEach((s, i) => {
      if (!map.has(s.songIndex)) map.set(s.songIndex, i)
    })
    return map
  }, [slides])

  const goTo = useCallback(
    (index: number, smooth = true) => {
      const track = trackRef.current
      if (!track || !slides) return
      const clamped = Math.max(0, Math.min(slides.length - 1, index))
      track.scrollTo({ left: clamped * track.clientWidth, behavior: smooth ? 'smooth' : 'auto' })
      currentRef.current = clamped
      setCurrent(clamped)
    },
    [slides],
  )

  // Jump to the requested song once pages are known.
  useLayoutEffect(() => {
    if (slides) goTo(firstSlideOfSong.get(startSong) ?? 0, false)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [slides])

  // Track viewport size; keep the same page in view after rotation/resizes.
  useEffect(() => {
    const track = trackRef.current
    if (!track) return
    const ro = new ResizeObserver(() => {
      setSize({ w: track.clientWidth, h: track.clientHeight })
      track.scrollTo({ left: currentRef.current * track.clientWidth })
    })
    ro.observe(track)
    return () => ro.disconnect()
  }, [slides])

  function onScroll() {
    const track = trackRef.current
    if (!track || !track.clientWidth) return
    const index = Math.round(track.scrollLeft / track.clientWidth)
    if (index !== currentRef.current) {
      currentRef.current = index
      setCurrent(index)
    }
  }

  // Keyboard and Bluetooth page-turner pedals (they send arrow / page keys).
  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if (['ArrowRight', 'PageDown', ' ', 'ArrowDown', 'Enter'].includes(e.key)) {
        e.preventDefault()
        goTo(currentRef.current + 1)
      } else if (['ArrowLeft', 'PageUp', 'ArrowUp', 'Backspace'].includes(e.key)) {
        e.preventDefault()
        goTo(currentRef.current - 1)
      } else if (e.key === 'Escape' && !document.fullscreenElement) {
        onClose()
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [goTo, onClose])

  // Keep the screen awake while charts are open.
  useEffect(() => {
    let lock: WakeLockSentinel | null = null
    const request = async () => {
      try {
        lock = (await navigator.wakeLock?.request('screen')) ?? null
      } catch {
        /* not supported or denied */
      }
    }
    const onVisible = () => document.visibilityState === 'visible' && request()
    request()
    document.addEventListener('visibilitychange', onVisible)
    return () => {
      document.removeEventListener('visibilitychange', onVisible)
      lock?.release().catch(() => {})
    }
  }, [])

  // Lock page scroll behind the viewer.
  useEffect(() => {
    const prev = document.body.style.overflow
    document.body.style.overflow = 'hidden'
    return () => {
      document.body.style.overflow = prev
      if (document.fullscreenElement) document.exitFullscreen().catch(() => {})
    }
  }, [])

  // Hide controls shortly after opening so the chart gets the whole screen.
  useEffect(() => {
    if (!slides) return
    const t = setTimeout(() => setChrome(false), 2500)
    return () => clearTimeout(t)
  }, [slides])

  function onTap(e: MouseEvent) {
    const x = e.clientX / window.innerWidth
    if (x < 0.28) goTo(currentRef.current - 1)
    else if (x > 0.72) goTo(currentRef.current + 1)
    else setChrome((c) => !c)
  }

  function toggleFit() {
    const next = fit === 'page' ? 'width' : 'page'
    setFit(next)
    writePref('ws.fit', next)
  }
  function toggleNight() {
    setNight(!night)
    writePref('ws.night', night ? 'off' : 'on')
  }
  function toggleFullscreen() {
    if (document.fullscreenElement) document.exitFullscreen().catch(() => {})
    else rootRef.current?.requestFullscreen?.().catch(() => {})
  }

  const slide = slides?.[current]
  const song = slide ? songs[slide.songIndex] : null
  const nextSong = slide && slide.pageNo === slide.pagesInSong ? songs[slide.songIndex + 1] : undefined

  return (
    <div ref={rootRef} className={`viewer ${night ? 'night' : ''}`} role="dialog" aria-label="Charts">
      {!slides ? (
        <div className="viewer-loading">Loading charts…</div>
      ) : (
        <div ref={trackRef} className="viewer-track" onScroll={onScroll} onClick={onTap}>
          {slides.map((s, i) => (
            <div className={`viewer-slide fit-${fit}`} key={`${s.songIndex}-${s.pageNo}`}>
              {s.doc ? (
                <PageCanvas
                  doc={s.doc}
                  pageNo={s.pageNo}
                  width={size.w}
                  height={size.h}
                  fit={fit}
                  active={Math.abs(i - current) <= 2}
                />
              ) : (
                <div className="viewer-missing">
                  <strong>{songs[s.songIndex].title}</strong>
                  <span>{s.error}</span>
                </div>
              )}
            </div>
          ))}
        </div>
      )}

      {slides && slides.length > 0 && (
        <div className={`viewer-progress ${chrome ? 'hidden' : ''}`}>
          {current + 1}/{slides.length}
        </div>
      )}
      {nextSong && !chrome && <div className="viewer-next">Next: {nextSong.title}</div>}

      <div className={`viewer-bar top ${chrome ? '' : 'hidden'}`}>
        <button className="icon-btn" onClick={onClose} aria-label="Close charts">✕</button>
        <div className="viewer-title">
          <strong>{song?.title ?? ''}</strong>
          {slide && (
            <span>
              {song?.song_key ? `Key ${song.song_key} · ` : ''}
              Song {slide.songIndex + 1}/{songs.length} · Page {slide.pageNo}/{slide.pagesInSong}
            </span>
          )}
        </div>
        <span className="viewer-count">{slides ? `${current + 1}/${slides.length}` : ''}</span>
      </div>

      <div className={`viewer-bar bottom ${chrome ? '' : 'hidden'}`}>
        <button className="icon-btn" onClick={() => goTo(current - 1)} aria-label="Previous page">‹</button>
        <button className="chip" onClick={() => setShowSongs(!showSongs)}>Songs</button>
        <button className="chip" onClick={toggleFit} aria-label={fit === 'page' ? 'Fit to width' : 'Fit whole page'}>
          {fit === 'page' ? '↔ Width' : '▣ Page'}
        </button>
        <button className="chip" onClick={toggleNight}>{night ? 'Day' : 'Night'}</button>
        {document.fullscreenEnabled && (
          <button className="chip" onClick={toggleFullscreen} aria-label="Full screen">⛶</button>
        )}
        <button className="icon-btn" onClick={() => goTo(current + 1)} aria-label="Next page">›</button>
      </div>

      {showSongs && chrome && (
        <div className="viewer-songs">
          {songs.map((s, i) => (
            <button
              key={s.id + i}
              className={slide?.songIndex === i ? 'on' : ''}
              onClick={() => {
                goTo(firstSlideOfSong.get(i) ?? 0, false)
                setShowSongs(false)
              }}
            >
              <span className="num">{i + 1}</span>
              <span className="grow">{s.title}</span>
              {s.song_key && <span className="key">{s.song_key}</span>}
            </button>
          ))}
        </div>
      )}
    </div>
  )
}

interface PageProps {
  doc: PdfDoc
  pageNo: number
  width: number
  height: number
  fit: Fit
  active: boolean
}

function PageCanvas({ doc, pageNo, width, height, fit, active }: PageProps) {
  const canvasRef = useRef<HTMLCanvasElement>(null)
  const [cssSize, setCssSize] = useState<{ w: number; h: number } | null>(null)

  useEffect(() => {
    const canvas = canvasRef.current
    if (!canvas || !width || !height) return
    let cancelled = false
    let task: { cancel: () => void; promise: Promise<void> } | null = null

    doc.getPage(pageNo).then((page) => {
      if (cancelled) return
      const base = page.getViewport({ scale: 1 })
      const scale = fit === 'width' ? width / base.width : Math.min(width / base.width, height / base.height)
      const w = Math.floor(base.width * scale)
      const h = Math.floor(base.height * scale)
      setCssSize({ w, h })
      if (!active) {
        // Free memory for pages far from view; keep the layout box.
        canvas.width = 0
        canvas.height = 0
        return
      }
      const dpr = Math.min(window.devicePixelRatio || 1, 3)
      const viewport = page.getViewport({ scale: scale * dpr })
      canvas.width = Math.floor(viewport.width)
      canvas.height = Math.floor(viewport.height)
      task = page.render({ canvas, viewport })
      task.promise.catch(() => {})
    })

    return () => {
      cancelled = true
      task?.cancel()
    }
  }, [doc, pageNo, width, height, fit, active])

  return (
    <canvas
      ref={canvasRef}
      className="viewer-page"
      style={cssSize ? { width: cssSize.w, height: cssSize.h } : undefined}
    />
  )
}
