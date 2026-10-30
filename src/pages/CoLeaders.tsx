import { useEffect, useState, type FormEvent } from 'react'
import { useLocation } from 'react-router-dom'
import { useAuth } from '../auth'
import NameForm from '../components/NameForm'
import {
  cancelInvite,
  createInvite,
  endCoLeadership,
  fetchMyPeople,
  fetchSentInvites,
  inviteMessage,
  inviteUrl,
  matchesPerson,
  personLabel,
  type Person,
  type SentInvite,
} from '../lib/people'
import { formatDate } from '../lib/format'

export default function CoLeaders() {
  const { email: me, displayName } = useAuth()
  const location = useLocation()
  const welcome = (location.state as { welcome?: string } | null)?.welcome
  const [people, setPeople] = useState<Person[] | null>(null)
  const [sent, setSent] = useState<SentInvite[]>([])
  const [inviteEmail, setInviteEmail] = useState('')
  const [justCreated, setJustCreated] = useState<SentInvite | null>(null)
  const [query, setQuery] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  async function load() {
    if (!me) return
    try {
      const [p, s] = await Promise.all([fetchMyPeople(), fetchSentInvites(me)])
      setPeople(p)
      setSent(s)
    } catch (e) {
      setError((e as Error).message)
    }
  }

  useEffect(() => {
    load()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [me])

  async function invite(e: FormEvent) {
    e.preventDefault()
    setBusy(true)
    setError(null)
    try {
      const address = inviteEmail.trim().toLowerCase()
      const token = await createInvite(address)
      setInviteEmail('')
      await load()
      setJustCreated({ token, invitee_email: address, created_at: new Date().toISOString(), expires_at: '' })
    } catch (err) {
      setError((err as Error).message)
    }
    setBusy(false)
  }

  async function cancel(inv: SentInvite) {
    if (!window.confirm(`Cancel the invite to ${inv.invitee_email}? The link will stop working.`)) return
    try {
      await cancelInvite(inv.token)
      if (justCreated?.token === inv.token) setJustCreated(null)
      await load()
    } catch (e) {
      setError((e as Error).message)
    }
  }

  async function remove(p: Person) {
    if (
      !window.confirm(
        `Stop being co-leaders with ${personLabel(p)}? You’ll each be taken off the other’s sets, and won’t see each other here any more.`,
      )
    )
      return
    try {
      await endCoLeadership(me!, p.email)
      await load()
    } catch (e) {
      setError((e as Error).message)
    }
  }

  const coLeaders = (people ?? []).filter((p) => !p.me)
  const shown = coLeaders.filter((p) => matchesPerson(p, query))

  return (
    <div className="narrow">
      <h1>Co-leaders</h1>
      {welcome && <div className="card notice-card">Welcome! You and {welcome} are now co-leaders.</div>}
      <p className="muted">
        Co-leaders can add each other to their sets. You only see your own co-leaders, not every leader on the app.
      </p>

      <section className="card">
        <h2>Your name</h2>
        <NameForm />
        {!displayName && <p className="muted small">Add your name so co-leaders can find you by it.</p>}
      </section>

      <section className="card">
        <h2>Invite a co-leader</h2>
        <form className="inline-form" onSubmit={invite}>
          <input
            type="email"
            required
            placeholder="their@email.com"
            value={inviteEmail}
            onChange={(e) => setInviteEmail(e.target.value)}
          />
          <button className="btn primary" disabled={busy}>{busy ? '…' : 'Invite'}</button>
        </form>
        <p className="muted small">
          You’ll get a link to send them however you like. When they open it and sign in with that email, you become
          co-leaders.
        </p>
        {justCreated && <InviteShare invite={justCreated} fromName={displayName} highlight />}
      </section>

      {error && <p className="error">{error}</p>}

      {sent.filter((s) => s.token !== justCreated?.token).length > 0 && (
        <section className="card">
          <h2>Waiting for a reply</h2>
          <ul className="plain-list">
            {sent
              .filter((s) => s.token !== justCreated?.token)
              .map((s) => (
                <li key={s.token}>
                  <div className="row-head">
                    <span className="row-title">{s.invitee_email}</span>
                    <button className="btn ghost small" onClick={() => cancel(s)}>Cancel</button>
                  </div>
                  <span className="muted small">
                    Sent {formatDate(s.created_at.slice(0, 10), { weekday: undefined, year: undefined })} · link works until{' '}
                    {formatDate(s.expires_at.slice(0, 10), { weekday: undefined, year: undefined })}
                  </span>
                  <InviteShare invite={s} fromName={displayName} />
                </li>
              ))}
          </ul>
        </section>
      )}

      <h2 className="section-label">Your co-leaders ({coLeaders.length})</h2>
      {coLeaders.length > 5 && (
        <input
          className="search"
          type="search"
          placeholder="Search by name or email"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
        />
      )}
      {!people ? (
        <p className="muted">Loading…</p>
      ) : coLeaders.length === 0 ? (
        <p className="muted">No co-leaders yet. Invite someone above.</p>
      ) : (
        <ul className="list">
          {shown.map((p) => (
            <li key={p.email} className="row">
              <span className="row-main">
                <span className="row-title">{p.name || <em className="muted">No name yet</em>}</span>
                <span className="muted small">{p.email}</span>
              </span>
              <button className="btn ghost small" onClick={() => remove(p)}>Remove</button>
            </li>
          ))}
          {shown.length === 0 && <li className="row"><span className="row-main muted">No matches.</span></li>}
        </ul>
      )}
    </div>
  )
}

function InviteShare({ invite, fromName, highlight }: { invite: SentInvite; fromName: string | null; highlight?: boolean }) {
  const [copied, setCopied] = useState(false)
  const url = inviteUrl(invite.token)
  const message = inviteMessage(fromName, invite.token)
  const subject = `${fromName || 'A worship leader'} invited you to Worship Sets`

  async function share() {
    try {
      await navigator.share({ title: subject, text: message })
    } catch {
      /* cancelled */
    }
  }
  async function copy() {
    try {
      await navigator.clipboard.writeText(url)
      setCopied(true)
      setTimeout(() => setCopied(false), 2000)
    } catch {
      window.prompt('Copy this link:', url)
    }
  }

  return (
    <div className={`invite-share ${highlight ? 'highlight' : ''}`}>
      {highlight && (
        <p className="small" style={{ margin: '0 0 6px' }}>
          Invite for <strong>{invite.invitee_email}</strong> is ready. Send them the link:
        </p>
      )}
      <code className="invite-link">{url}</code>
      <div className="actions">
        {'share' in navigator && (
          <button type="button" className="btn small primary" onClick={share}>Share…</button>
        )}
        <button type="button" className="btn small" onClick={copy}>{copied ? 'Copied ✓' : 'Copy link'}</button>
        <a
          className="btn small"
          href={`mailto:${encodeURIComponent(invite.invitee_email)}?subject=${encodeURIComponent(subject)}&body=${encodeURIComponent(message)}`}
        >
          Email
        </a>
      </div>
    </div>
  )
}
