import { lazy, Suspense, useEffect, useState } from 'react'
import { Link, useParams } from 'react-router-dom'
import { useAuth } from '../auth'
import EventDetails from '../components/EventDetails'
import { supabase } from '../lib/supabase'
import { cachedSet, rememberSet } from '../lib/recent'
import type { SharedEvent as SharedEventData } from '../lib/types'

// pdf.js is large; load it only when someone opens the charts.
const Viewer = lazy(() => import('../components/Viewer'))

export default function SharedEvent() {
  const { shareId = '' } = useParams()
  const { isLeader } = useAuth()
  const [event, setEvent] = useState<SharedEventData | null>(() => cachedSet(shareId))
  const [status, setStatus] = useState<'loading' | 'ok' | 'offline' | 'missing'>('loading')
  const [viewerAt, setViewerAt] = useState<number | null>(null)
  const [canEdit, setCanEdit] = useState(false)

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
      <EventDetails event={event} onOpenSong={(i) => setViewerAt(i)} />
      {viewerAt !== null && (
        <Suspense fallback={<div className="viewer"><div className="viewer-loading">Loading charts…</div></div>}>
          <Viewer songs={event.songs} startSong={viewerAt} onClose={() => setViewerAt(null)} />
        </Suspense>
      )}
    </div>
  )
}
