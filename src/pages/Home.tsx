import { useEffect, useState } from 'react'
import { Link } from 'react-router-dom'
import { useAuth } from '../auth'
import { supabase } from '../lib/supabase'
import { formatDate, shareLink, shareUrl, todayIso } from '../lib/format'
import { recentSets, forgetSet, type RecentSet } from '../lib/recent'
import type { EventRow } from '../lib/types'

export default function Home() {
  const { loading, session, isLeader, email } = useAuth()
  if (loading) return <div className="center muted">Loading…</div>
  if (isLeader) return <SetsDashboard />
  return (
    <div className="narrow">
      {session && !isLeader && (
        <div className="card notice-card">
          <strong>You’re signed in as {email}</strong>, but this address isn’t on the Leaders list yet. Ask an
          existing leader to add it under <em>Leaders</em>.
        </div>
      )}
      <RecentSetsList />
    </div>
  )
}

function RecentSetsList() {
  const [list, setList] = useState<RecentSet[]>(() => recentSets())
  return (
    <>
      <h1>Your sets</h1>
      {list.length === 0 ? (
        <p className="muted">
          Open a set link your worship leader shared with you, and it will show up here — even offline.
        </p>
      ) : (
        <ul className="list">
          {list.map((r) => (
            <li key={r.share_id} className="row">
              <Link to={`/s/${r.share_id}`} className="row-main">
                <span className="row-title">{r.name}</span>
                <span className="muted small">{formatDate(r.event_date)}</span>
              </Link>
              <button
                className="btn ghost small"
                aria-label={`Remove ${r.name}`}
                onClick={() => {
                  forgetSet(r.share_id)
                  setList(recentSets())
                }}
              >
                ✕
              </button>
            </li>
          ))}
        </ul>
      )}
    </>
  )
}

function SetsDashboard() {
  const { email: me } = useAuth()
  const [events, setEvents] = useState<(EventRow & { song_count: number })[] | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [showPast, setShowPast] = useState(false)
  const [toast, setToast] = useState<string | null>(null)

  useEffect(() => {
    supabase
      .from('events')
      .select('*, event_songs(count)')
      .order('event_date', { ascending: true, nullsFirst: false })
      .then(({ data, error }) => {
        if (error) setError(error.message)
        else
          setEvents(
            (data ?? []).map((e) => ({
              ...(e as EventRow),
              song_count: (e as { event_songs: { count: number }[] }).event_songs[0]?.count ?? 0,
            })),
          )
      })
  }, [])

  const today = todayIso()
  const upcoming = (events ?? []).filter((e) => !e.event_date || e.event_date >= today)
  const past = (events ?? []).filter((e) => e.event_date && e.event_date < today).reverse()

  async function share(e: EventRow) {
    const result = await shareLink(e.name, shareUrl(e.share_id))
    if (result === 'copied') {
      setToast('Link copied')
      setTimeout(() => setToast(null), 2000)
    }
  }

  const renderRow = (e: EventRow & { song_count: number }) => (
    <li key={e.id} className="row">
      <Link to={`/sets/${e.id}`} className="row-main">
        <span className="row-title">{e.name}</span>
        <span className="muted small">
          {[formatDate(e.event_date), e.start_time, e.location].filter(Boolean).join(' · ')}
          {' · '}
          {e.song_count} {e.song_count === 1 ? 'song' : 'songs'}
          {e.created_by_email && e.created_by_email !== me && ` · from ${e.created_by_email}`}
        </span>
      </Link>
      <Link to={`/s/${e.share_id}`} className="btn ghost small">View</Link>
      <button className="btn ghost small" onClick={() => share(e)}>Share</button>
    </li>
  )

  return (
    <div>
      <div className="page-head">
        <h1>Sets</h1>
        <Link to="/sets/new" className="btn primary">+ New set</Link>
      </div>
      {error && <p className="error">{error}</p>}
      {!events ? (
        <p className="muted">Loading…</p>
      ) : (
        <>
          <h2 className="section-label">Upcoming</h2>
          {upcoming.length === 0 ? (
            <p className="muted">No upcoming sets. Create one to get started.</p>
          ) : (
            <ul className="list">{upcoming.map(renderRow)}</ul>
          )}
          {past.length > 0 && (
            <>
              <button className="btn ghost small" onClick={() => setShowPast(!showPast)}>
                {showPast ? 'Hide' : 'Show'} past sets ({past.length})
              </button>
              {showPast && <ul className="list">{past.map(renderRow)}</ul>}
            </>
          )}
        </>
      )}
      {toast && <div className="toast">{toast}</div>}
    </div>
  )
}
