import { useEffect, useState } from 'react'
import { adminRemoveLeader, cancelInvite, fetchAdminOverview, type AdminOverview } from '../lib/people'
import { formatDate } from '../lib/format'

const shortDate = (iso: string) => formatDate(iso.slice(0, 10), { weekday: undefined, year: undefined })

function ago(iso: string) {
  const days = Math.floor((Date.now() - Date.parse(iso)) / 86_400_000)
  return days <= 0 ? 'today' : days === 1 ? 'yesterday' : `${days} days ago`
}

function megabytes(bytes: number) {
  return bytes < 1024 * 1024 ? `${Math.max(1, Math.round(bytes / 1024))} KB` : `${(bytes / 1024 / 1024).toFixed(1)} MB`
}

/** App owner only: who uses the app and how much it holds — no set contents. */
export default function Admin() {
  const [data, setData] = useState<AdminOverview | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [loading, setLoading] = useState(false)

  async function load() {
    setLoading(true)
    try {
      setData(await fetchAdminOverview())
      setError(null)
    } catch (e) {
      setError((e as Error).message)
    }
    setLoading(false)
  }

  useEffect(() => {
    load()
  }, [])

  async function remove(email: string, name: string | null) {
    if (
      !window.confirm(
        `Remove ${name || email} as a leader? Their sets are deleted, they’re taken off other leaders’ sets and co-leader lists, and their open invites are cancelled. Songs they uploaded stay in the library.`,
      )
    )
      return
    try {
      await adminRemoveLeader(email)
      await load()
    } catch (e) {
      window.alert((e as Error).message)
    }
  }

  async function cancel(token: string, to: string) {
    if (!window.confirm(`Cancel the invite to ${to}?`)) return
    try {
      await cancelInvite(token)
      await load()
    } catch (e) {
      window.alert((e as Error).message)
    }
  }

  if (error) return <p className="error">{error}</p>
  if (!data) return <p className="muted">Loading…</p>
  const t = data.totals

  return (
    <div className="narrow">
      <div className="page-head">
        <h1>App overview</h1>
        <button className="btn ghost small" onClick={load} disabled={loading}>{loading ? '…' : '↻ Refresh'}</button>
      </div>
      <p className="muted small">
        Only you can see this. It shows who uses the app and how much it stores, not what’s in anyone’s sets. Sets are
        deleted automatically a week after their date (each night), unless a leader ticked “Keep”.
      </p>

      <section className="stats">
        <Stat label="Leaders" value={t.leaders} />
        <Stat label="Active (7 days)" value={t.active_7d} />
        <Stat label="Co-leader pairs" value={t.pairs} />
        <Stat label="Sets" value={t.sets} sub={`${t.upcoming_sets} upcoming · ${t.kept_sets} kept`} />
        <Stat label="Songs" value={t.songs} sub={`${megabytes(t.pdf_bytes)} of charts`} />
        <Stat label="Open invites" value={t.open_invites} />
      </section>

      <h2 className="section-label">Leaders ({data.leaders.length})</h2>
      <ul className="list">
        {data.leaders.map((l) => (
          <li key={l.email} className="row admin-row">
            <span className="row-main">
              <span className="row-title">
                {l.name || <em className="muted">No name yet</em>}
                {l.is_admin && <span className="muted small"> · you (admin)</span>}
              </span>
              <span className="muted small">{l.email}</span>
              <span className="muted small">
                Joined {shortDate(l.added_at)} · {l.last_sign_in ? `last signed in ${ago(l.last_sign_in)}` : 'never signed in'} ·{' '}
                {l.sets} set{l.sets === 1 ? '' : 's'} ·{' '}
                {l.songs} song{l.songs === 1 ? '' : 's'} uploaded
              </span>
              <span className="muted small">
                Co-leaders: {l.co_leaders.length ? l.co_leaders.join(', ') : 'none'}
              </span>
            </span>
            {!l.is_admin && (
              <button className="btn ghost small danger-text" onClick={() => remove(l.email, l.name)}>Remove</button>
            )}
          </li>
        ))}
      </ul>

      {data.invites.length > 0 && (
        <>
          <h2 className="section-label">Open invites ({data.invites.length})</h2>
          <ul className="list">
            {data.invites.map((i) => (
              <li key={i.token} className="row">
                <span className="row-main">
                  <span className="row-title">{i.invitee_email}</span>
                  <span className="muted small">
                    From {i.inviter} · sent {shortDate(i.created_at)} · expires {shortDate(i.expires_at)}
                  </span>
                </span>
                <button className="btn ghost small" onClick={() => cancel(i.token, i.invitee_email)}>Cancel</button>
              </li>
            ))}
          </ul>
        </>
      )}
    </div>
  )
}

function Stat({ label, value, sub }: { label: string; value: number; sub?: string }) {
  return (
    <div className="stat">
      <div className="stat-value">{value}</div>
      <div className="stat-label">{label}</div>
      {sub && <div className="stat-sub">{sub}</div>}
    </div>
  )
}
