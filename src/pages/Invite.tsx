import { useEffect, useState } from 'react'
import { Link, useNavigate, useParams } from 'react-router-dom'
import { useAuth } from '../auth'
import { supabase } from '../lib/supabase'
import { acceptInvite, declineInvite, getInvite, rememberInviteToken, saveMyName, type InviteInfo } from '../lib/people'

/** Where an invite link lands: sign in with the invited email, add your name, accept. */
export default function Invite() {
  const { token = '' } = useParams()
  const navigate = useNavigate()
  const { loading, session, email, userId, displayName, refresh } = useAuth()
  const [invite, setInvite] = useState<InviteInfo | null | undefined>(undefined)
  const [name, setName] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    getInvite(token).then(setInvite, () => setInvite(null))
  }, [token])

  // If they still have to sign in or confirm their email, pick this invite up again afterwards.
  useEffect(() => {
    if (invite?.status === 'pending' && !session) rememberInviteToken(token)
  }, [invite, session, token])

  if (loading || invite === undefined) return <p className="muted">Loading…</p>

  if (!invite) {
    return (
      <div className="narrow">
        <h1>Invite not found</h1>
        <p className="muted">This link isn’t valid. Ask the person who invited you to send a new one.</p>
      </div>
    )
  }

  const from = invite.inviter_name || invite.inviter_email
  const next = `/invite/${token}`

  if (invite.status !== 'pending') {
    return (
      <div className="narrow">
        <h1>Invite {invite.status}</h1>
        <p className="muted">
          {invite.status === 'accepted'
            ? `This invite has already been accepted. You and ${from} are co-leaders.`
            : `This invite is no longer open. Ask ${from} to send a new one.`}
        </p>
        <Link to="/" className="btn">Go to your sets</Link>
      </div>
    )
  }

  async function accept() {
    setBusy(true)
    setError(null)
    try {
      if (!displayName) {
        if (!name.trim()) throw new Error('Add your name first, so your co-leaders can find you.')
        await saveMyName(email!, userId!, name)
      }
      await acceptInvite(token)
      await refresh()
      navigate('/co-leaders', { replace: true, state: { welcome: from } })
    } catch (e) {
      setError((e as Error).message)
      setBusy(false)
    }
  }

  async function decline() {
    if (!window.confirm(`Decline ${from}’s invite?`)) return
    setBusy(true)
    try {
      await declineInvite(token)
      navigate('/', { replace: true })
    } catch (e) {
      setError((e as Error).message)
      setBusy(false)
    }
  }

  return (
    <div className="narrow">
      <h1>You’re invited</h1>
      <div className="card">
        <p style={{ marginTop: 0 }}>
          <strong>{from}</strong> invited <strong>{invite.invitee_email}</strong> to lead worship sets together. As
          co-leaders you can add each other to your sets and share the song library.
        </p>

        {!session ? (
          <>
            <p className="muted small">
              Sign in, or create an account, with <strong>{invite.invitee_email}</strong> to accept.
            </p>
            <div className="actions">
              <Link
                className="btn primary"
                to={`/login?mode=signup&email=${encodeURIComponent(invite.invitee_email)}&next=${encodeURIComponent(next)}`}
              >
                Create account
              </Link>
              <Link
                className="btn"
                to={`/login?email=${encodeURIComponent(invite.invitee_email)}&next=${encodeURIComponent(next)}`}
              >
                I have an account — sign in
              </Link>
            </div>
          </>
        ) : email !== invite.invitee_email ? (
          <>
            <p className="error">
              You’re signed in as {email}, but this invite is for {invite.invitee_email}.
            </p>
            <button
              className="btn"
              onClick={async () => {
                rememberInviteToken(token)
                await supabase.auth.signOut()
                navigate(`/login?email=${encodeURIComponent(invite.invitee_email)}&next=${encodeURIComponent(next)}`)
              }}
            >
              Sign out and use {invite.invitee_email}
            </button>
          </>
        ) : (
          <div className="form">
            {!displayName && (
              <label>
                Your name
                <input
                  value={name}
                  onChange={(e) => setName(e.target.value)}
                  placeholder="e.g. Henro Verhoef"
                  autoComplete="name"
                  maxLength={60}
                />
                <span className="muted small" style={{ fontWeight: 400 }}>
                  Co-leaders find you by this name.
                </span>
              </label>
            )}
            {error && <p className="error">{error}</p>}
            <div className="actions">
              <button className="btn primary" onClick={accept} disabled={busy}>
                {busy ? 'Please wait…' : 'Accept invite'}
              </button>
              <button className="btn ghost" onClick={decline} disabled={busy}>Decline</button>
            </div>
          </div>
        )}
      </div>
    </div>
  )
}
