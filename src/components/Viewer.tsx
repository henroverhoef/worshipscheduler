import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState, type MouseEvent } from 'react'
import { loadPdf, type PdfDoc } from '../lib/pdf'
import { chartUrl } from '../lib/supabase'
import type { SetSong } from '../lib/types'

type Fit = 'page' | 'width'

const MAX_ZOOM = 5
// Stay under mobile browsers' canvas size limits (iOS Safari caps around 16.7M pixels).
const MAX_CANVAS_PIXELS = 12_000_000

const clamp = (v: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, v))

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
  // Zoom of the current page (1 = fitted). The zoomed page pans with normal scrolling inside its slide.
  const [zoom, setZoom] = useState(1)
  const zoomRef = useRef(1)
  // Keeps the point of the page under the fingers (fx, fy as fractions of the page) at screen point (mx, my).
  const anchor = useRef<{ fx: number; fy: number; mx: number; my: number } | null>(null)
  const suppressTapUntil = useRef(0)
  const lastTap = useRef<{ t: number; x: number; y: number } | null>(null)
  const tapTimer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined)

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
      resetZoom()
      track.scrollTo({ left: clamped * track.clientWidth, behavior: smooth ? 'smooth' : 'auto' })
      currentRef.current = clamped
      setCurrent(clamped)
    },
    [slides],
  )

  function activePage(): { slide: HTMLElement; page: HTMLElement } | null {
    const slide = trackRef.current?.children[currentRef.current] as HTMLElement | undefined
    const page = slide?.firstElementChild as HTMLElement | null | undefined
    return slide && page instanceof HTMLCanvasElement ? { slide, page } : null
  }

  function resetZoom() {
    anchor.current = null
    if (zoomRef.current === 1) return
    zoomRef.current = 1
    setZoom(1)
  }

  /** Zoom the current page to `next`, keeping the page point under (clientX, clientY) in place. */
  function zoomAt(next: number, clientX: number, clientY: number, frac?: { fx: number; fy: number }) {
    const active = activePage()
    if (!active) return
    const slideRect = active.slide.getBoundingClientRect()
    let fx = frac?.fx
    let fy = frac?.fy
    if (fx === undefined || fy === undefined) {
      const r = active.page.getBoundingClientRect()
      fx = clamp((clientX - r.left) / r.width, 0, 1)
      fy = clamp((clientY - r.top) / r.height, 0, 1)
    }
    anchor.current = { fx, fy, mx: clientX - slideRect.left, my: clientY - slideRect.top }
    const z = clamp(next, 1, MAX_ZOOM)
    if (z === zoomRef.current) {
      applyAnchor() // e.g. two-finger pan at max zoom
    } else {
      zoomRef.current = z
      setZoom(z)
    }
  }

  function applyAnchor() {
    const a = anchor.current
    const active = activePage()
    if (!a || !active) return
    const { slide, page } = active
    slide.scrollLeft = page.offsetLeft + a.fx * page.offsetWidth - a.mx
    slide.scrollTop = page.offsetTop + a.fy * page.offsetHeight - a.my
  }

  // After the page has its new size, scroll so the pinch point stays under the fingers.
  useLayoutEffect(() => {
    applyAnchor()
    if (zoom === 1) anchor.current = null
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [zoom])

  // Pinch to zoom (touch) and ctrl/trackpad-pinch wheel (desktop). The browser's own page zoom is
  // turned off in the viewer: it fought the page-swipe strip and snapped back to the left edge.
  useEffect(() => {
    const track = trackRef.current
    if (!track) return
    let pinch: { dist: number; zoom: number; fx: number; fy: number } | null = null
    const dist = (t: TouchList) => Math.hypot(t[0].clientX - t[1].clientX, t[0].clientY - t[1].clientY)
    const mid = (t: TouchList) => ({ x: (t[0].clientX + t[1].clientX) / 2, y: (t[0].clientY + t[1].clientY) / 2 })

    function onTouchStart(e: TouchEvent) {
      if (e.touches.length !== 2) return
      const active = activePage()
      if (!active) return
      if (e.cancelable) e.preventDefault()
      const m = mid(e.touches)
      const r = active.page.getBoundingClientRect()
      pinch = {
        dist: dist(e.touches),
        zoom: zoomRef.current,
        fx: clamp((m.x - r.left) / r.width, 0, 1),
        fy: clamp((m.y - r.top) / r.height, 0, 1),
      }
    }
    function onTouchMove(e: TouchEvent) {
      if (!pinch || e.touches.length !== 2) return
      if (e.cancelable) e.preventDefault()
      const m = mid(e.touches)
      zoomAt((pinch.zoom * dist(e.touches)) / pinch.dist, m.x, m.y, { fx: pinch.fx, fy: pinch.fy })
    }
    function onTouchEnd(e: TouchEvent) {
      if (!pinch || e.touches.length >= 2) return
      pinch = null
      suppressTapUntil.current = Date.now() + 400
      if (zoomRef.current < 1.08) resetZoom()
    }
    function onWheel(e: WheelEvent) {
      if (!e.ctrlKey) return
      e.preventDefault()
      zoomAt(zoomRef.current * Math.exp(-e.deltaY * 0.01), e.clientX, e.clientY)
    }
    // iOS Safari: stop its own page zoom gesture.
    const stop = (e: Event) => e.preventDefault()

    track.addEventListener('touchstart', onTouchStart, { passive: false })
    track.addEventListener('touchmove', onTouchMove, { passive: false })
    track.addEventListener('touchend', onTouchEnd)
    track.addEventListener('touchcancel', onTouchEnd)
    track.addEventListener('wheel', onWheel, { passive: false })
    document.addEventListener('gesturestart', stop)
    return () => {
      track.removeEventListener('touchstart', onTouchStart)
      track.removeEventListener('touchmove', onTouchMove)
      track.removeEventListener('touchend', onTouchEnd)
      track.removeEventListener('touchcancel', onTouchEnd)
      track.removeEventListener('wheel', onWheel)
      document.removeEventListener('gesturestart', stop)
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [slides])

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
      resetZoom()
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
      } else if (e.key === 'Escape' && zoomRef.current > 1) {
        resetZoom()
      } else if (e.key === 'Escape' && !document.fullscreenElement) {
        onClose()
      } else if (e.key === '+' || e.key === '=' || e.key === '-' || e.key === '0') {
        const track = trackRef.current
        if (!track) return
        const r = track.getBoundingClientRect()
        const next = e.key === '0' ? 1 : zoomRef.current * (e.key === '-' ? 1 / 1.25 : 1.25)
        if (next <= 1) resetZoom()
        else zoomAt(next, r.left + r.width / 2, r.top + r.height / 2)
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
    if (Date.now() < suppressTapUntil.current) return
    const zoomed = zoomRef.current > 1
    const x = e.clientX / window.innerWidth
    // Edges turn pages, but not while zoomed in (a tap there is just looking at the page).
    if (!zoomed && x < 0.28) return goTo(currentRef.current - 1)
    if (!zoomed && x > 0.72) return goTo(currentRef.current + 1)
    // Middle: single tap shows/hides controls, double tap zooms in or back out.
    const now = Date.now()
    const last = lastTap.current
    if (last && now - last.t < 300 && Math.hypot(e.clientX - last.x, e.clientY - last.y) < 40) {
      clearTimeout(tapTimer.current)
      lastTap.current = null
      if (zoomed) resetZoom()
      else zoomAt(2.5, e.clientX, e.clientY)
      return
    }
    lastTap.current = { t: now, x: e.clientX, y: e.clientY }
    clearTimeout(tapTimer.current)
    tapTimer.current = setTimeout(() => setChrome((c) => !c), 260)
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
        <div ref={trackRef} className={`viewer-track ${zoom > 1 ? 'zoomed' : ''}`} onScroll={onScroll} onClick={onTap}>
          {slides.map((s, i) => (
            <div className={`viewer-slide ${i === current && zoom > 1 ? 'zoomed' : ''}`} key={`${s.songIndex}-${s.pageNo}`}>
              {s.doc ? (
                <PageCanvas
                  doc={s.doc}
                  pageNo={s.pageNo}
                  width={size.w}
                  height={size.h}
                  fit={fit}
                  zoom={i === current ? zoom : 1}
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

      {zoom > 1 && (
        <button className="viewer-zoom" onClick={resetZoom} aria-label="Reset zoom">
          {zoom.toFixed(1)}× · Reset
        </button>
      )}
      {slides && slides.length > 0 && zoom === 1 && (
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
  zoom: number
  active: boolean
}

function PageCanvas({ doc, pageNo, width, height, fit, zoom, active }: PageProps) {
  const canvasRef = useRef<HTMLCanvasElement>(null)
  const [base, setBase] = useState<{ w: number; h: number } | null>(null)
  // While pinching, only the CSS size follows the fingers; the sharp re-render waits until they settle.
  const [renderZoom, setRenderZoom] = useState(zoom)

  useEffect(() => {
    if (zoom === 1) return setRenderZoom(1)
    const t = setTimeout(() => setRenderZoom(zoom), 180)
    return () => clearTimeout(t)
  }, [zoom])

  useEffect(() => {
    let cancelled = false
    doc.getPage(pageNo).then((page) => {
      if (cancelled) return
      const vp = page.getViewport({ scale: 1 })
      setBase({ w: vp.width, h: vp.height })
    })
    return () => {
      cancelled = true
    }
  }, [doc, pageNo])

  const fitScale = base && width && height
    ? fit === 'width' ? width / base.w : Math.min(width / base.w, height / base.h)
    : 0

  useEffect(() => {
    const canvas = canvasRef.current
    if (!canvas || !base || !fitScale) return
    if (!active) {
      // Free memory for pages far from view; the CSS size keeps the layout box.
      canvas.width = 0
      canvas.height = 0
      return
    }
    let cancelled = false
    let task: { cancel: () => void; promise: Promise<void> } | null = null
    doc.getPage(pageNo).then((page) => {
      if (cancelled) return
      const dpr = Math.min(window.devicePixelRatio || 1, 3)
      let scale = fitScale * renderZoom * dpr
      const pixels = base.w * base.h * scale * scale
      if (pixels > MAX_CANVAS_PIXELS) scale *= Math.sqrt(MAX_CANVAS_PIXELS / pixels)
      const viewport = page.getViewport({ scale })
      // Render off-screen, then swap in, so the page never flashes blank while re-rendering.
      const off = document.createElement('canvas')
      off.width = Math.floor(viewport.width)
      off.height = Math.floor(viewport.height)
      task = page.render({ canvas: off, viewport })
      task.promise
        .then(() => {
          if (cancelled) return
          canvas.width = off.width
          canvas.height = off.height
          canvas.getContext('2d')?.drawImage(off, 0, 0)
        })
        .catch(() => {})
    })
    return () => {
      cancelled = true
      task?.cancel()
    }
  }, [doc, pageNo, base, fitScale, renderZoom, active])

  return (
    <canvas
      ref={canvasRef}
      className="viewer-page"
      style={base && fitScale ? { width: Math.floor(base.w * fitScale * zoom), height: Math.floor(base.h * fitScale * zoom) } : undefined}
    />
  )
}
