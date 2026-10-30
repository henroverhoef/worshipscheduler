import { useEffect, useState } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import { useAuth } from '../auth'
import NameForm from '../components/NameForm'
import { fetchMyInvites, fetchNames, takeInviteToken, type MyInvite } from '../lib/people'
import { supabase } from '../lib/supabase'
import { formatDate, shareLink, shareText, shareUrl, todayIso } from '../lib/format'
import { recentSets, forgetSet, type RecentSet } from '../lib/recent'
import type { EventRow } from '../lib/types'

export default function Home() {
  const { loading, session, isLeader, email, displayName } = useAuth()
  const navigate = useNavigate()
  const [invites, setInvites] = useState<MyInvite[]>([])

  // Back from signing in / confirming email after opening an invite link: return to it.
  useEffect(() => {
    if (!session) return
    const token = takeInviteToken()
    if (token) navigate(`/invite/${token}`, { replace: true })
    else fetchMyInvites().then(setInvites, () => setInvites([]))
  }, [session, navigate])

  if (loading) return <div className="center muted">Loading…</div>
  const inviteCards = invites.map((i) => (
    <div key={i.token} className="card notice-card invite-card">
      <span>
        <strong>{i.inviter_name || i.inviter_email}</strong> invited you to lead worship sets together.
      </span>
      <Link className="btn primary small" to={`/invite/${i.token}`}>View invite</Link>
    </div>
  ))
  if (isLeader)
    return (
      <>
        {inviteCards}
        {!displayName && (
          <div className="card notice-card">
            <strong>Hey, you haven’t added your name yet.</strong> Co-leaders find you by it.
            <NameForm />
          </div>
        )}
        <SetsDashboard />
      </>
    )
  return (
    <div className="narrow">
      {inviteCards}
      {session && !isLeader && invites.length === 0 && (
        <div className="card notice-card">
          <strong>You’re signed in as {email}</strong>, but you’re not a leader yet. Ask a worship leader to invite you
          from their <em>Co-leaders</em> page.
        </div>
      )}
      <RecentSetsList />
    </div>
  )
}

/** The nightly cleanup removes a set once it's more than 7 days past its date (or creation, if undated). */
function removalDate(e: EventRow) {
  const base = e.event_date ?? e.created_at.slice(0, 10)
  const [y, m, d] = base.split('-').map(Number)
  const r = new Date(y, m - 1, d + 8)
  const pad = (n: number) => String(n).padStart(2, '0')
  return `${r.getFullYear()}-${pad(r.getMonth() + 1)}-${pad(r.getDate())}`
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
  const [names, setNames] = useState<Record<string, string>>({})

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
        // Show who shared a set by name rather than email.
        fetchNames((data ?? []).map((e) => e.created_by_email as string)).then(setNames)
      })
  }, [])

  const today = todayIso()
  const upcoming = (events ?? []).filter((e) => !e.event_date || e.event_date >= today)
  const past = (events ?? []).filter((e) => e.event_date && e.event_date < today).reverse()

  async function share(e: EventRow) {
    const result = await shareLink(e.name, shareUrl(e.share_id), shareText(e))
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
          {e.created_by_email && e.created_by_email !== me && ` · from ${names[e.created_by_email] ?? e.created_by_email}`}
        </span>
        {e.keep ? (
          <span className="badge">Kept</span>
        ) : e.event_date && e.event_date < today ? (
          <span className="muted small">Removed automatically {formatDate(removalDate(e), { year: undefined })}</span>
        ) : null}
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
          <p className="muted small">
            Sets are removed automatically a week after their date. Tick <em>Keep</em> in a set to hold on to it, e.g. as a
            template.
          </p>
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
