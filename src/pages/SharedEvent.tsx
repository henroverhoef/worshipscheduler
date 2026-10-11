import { lazy, Suspense, useCallback, useEffect, useState } from 'react'
import { Link, useParams } from 'react-router-dom'
import { useAuth } from '../auth'
import EventDetails from '../components/EventDetails'
import { supabase } from '../lib/supabase'
import { cachedSet, rememberSet } from '../lib/recent'
import { marksFromRows, marksToRows, type MarksByPage } from '../lib/marks'
import type { SharedEvent as SharedEventData } from '../lib/types'

// pdf.js is large; load it only when someone opens the charts.
const Viewer = lazy(() => import('../components/Viewer'))

export default function SharedEvent() {
  const { shareId = '' } = useParams()
  const { isLeader } = useAuth()
  const [event, setEvent] = useState<SharedEventData | null>(() => cachedSet(shareId))
  const [status, setStatus] = useState<'loading' | 'ok' | 'offline' | 'missing'>('loading')
  const [viewerAt, setViewerAt] = useState<number | null>(null)
  const [marks, setMarks] = useState<MarksByPage>(() => marksFromRows(cachedSet(shareId)?.annotations))
  const [canEdit, setCanEdit] = useState(false)
  const [downloading, setDownloading] = useState<string | null>(null)
  const [downloadNote, setDownloadNote] = useState<string | null>(null)

  // Keep the offline copy in step with markings made in the viewer.
  const onMarksChange = useCallback(
    (next: MarksByPage) => {
      setMarks(next)
      if (event) rememberSet({ ...event, annotations: marksToRows(next) })
    },
    [event],
  )

  async function downloadCharts() {
    if (!event) return
    setDownloadNote(null)
    setDownloading('Preparing PDF…')
    try {
      const { mergeCharts, saveBlob, pdfFileName } = await import('../lib/mergePdf')
      const { blob, skipped } = await mergeCharts(
        event.name,
        event.songs,
        (done, total) => setDownloading(`Preparing PDF… ${done}/${total}`),
        marks,
      )
      saveBlob(blob, pdfFileName(event.name, event.event_date))
      if (skipped.length) setDownloadNote(`Not included (no chart or couldn’t load): ${skipped.join(', ')}`)
    } catch (e) {
      setDownloadNote((e as Error).message || 'Couldn’t create the PDF. Check your connection and try again.')
    }
    setDownloading(null)
  }

  // Leaders only get an Edit button on sets they lead (row level security hides the rest).
  useEffect(() => {
    if (!isLeader || !event?.id) return setCanEdit(false)
    supabase
      .from('events')
      .select('id')
      .eq('id', event.id)
      .maybeSingle()
      .then(({ data }) => setCanEdit(!!data))
  }, [isLeader, event?.id])

  useEffect(() => {
    let cancelled = false
    supabase.rpc('get_shared_event', { p_share_id: shareId }).then(({ data, error }) => {
      if (cancelled) return
      if (error) {
        setStatus(cachedSet(shareId) ? 'offline' : 'missing')
      } else if (!data) {
        setStatus('missing')
        setEvent(null)
      } else {
        const ev = data as SharedEventData
        setEvent(ev)
        setMarks(marksFromRows(ev.annotations))
        rememberSet(ev)
        setStatus('ok')
      }
    })
    return () => {
      cancelled = true
    }
  }, [shareId])

  useEffect(() => {
    if (event) document.title = `${event.name} · Worship Sets`
    return () => {
      document.title = 'Worship Sets'
    }
  }, [event])

  if (!event) {
    return (
      <div className="shared-page">
        <div className="narrow center-block">
          {status === 'loading' ? (
            <p className="muted">Loading set…</p>
          ) : (
            <>
              <h1>Set not found</h1>
              <p className="muted">This link may have been removed, or you’re offline. Check with your worship leader.</p>
              <Link to="/" className="btn">Go home</Link>
            </>
          )}
        </div>
      </div>
    )
  }

  return (
    <div className="shared-page">
      <div className="shared-top">
        <Link to="/" className="btn ghost small">‹ Sets</Link>
        {canEdit && (
          <Link to={`/sets/${event.id}`} className="btn ghost small">Edit</Link>
        )}
      </div>
      {status === 'offline' && <p className="notice narrow">You’re offline — showing the last saved copy of this set.</p>}
      <EventDetails
        event={event}
        onOpenSong={(i) => setViewerAt(i)}
        onDownload={downloadCharts}
        downloading={downloading}
        downloadNote={downloadNote}
      />
      {viewerAt !== null && (
        <Suspense fallback={<div className="viewer"><div className="viewer-loading">Loading charts…</div></div>}>
          <Viewer
            songs={event.songs}
            startSong={viewerAt}
            onClose={() => setViewerAt(null)}
            marks={marks}
            markup={canEdit ? { eventId: event.id, onMarksChange } : undefined}
          />
        </Suspense>
      )}
    </div>
  )
}
