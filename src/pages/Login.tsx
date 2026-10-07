import { useState, type FormEvent } from 'react'
import { Navigate } from 'react-router-dom'
import { useAuth } from '../auth'
import { supabase } from '../lib/supabase'

type Mode = 'signin' | 'signup' | 'link'

export default function Login() {
  const { session } = useAuth()
  const [mode, setMode] = useState<Mode>('signin')
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [busy, setBusy] = useState(false)
  const [message, setMessage] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)

  if (session) return <Navigate to="/" replace />

  async function submit(e: FormEvent) {
    e.preventDefault()
    setBusy(true)
    setError(null)
    setMessage(null)
    const redirect = window.location.origin
    const clean = email.trim().toLowerCase()
    let err: { message: string } | null = null
    if (mode === 'signin') {
      ;({ error: err } = await supabase.auth.signInWithPassword({ email: clean, password }))
    } else if (mode === 'signup') {
      const res = await supabase.auth.signUp({ email: clean, password, options: { emailRedirectTo: redirect } })
      err = res.error
      if (!err && !res.data.session) setMessage('Check your email to confirm your account, then sign in here.')
    } else {
      ;({ error: err } = await supabase.auth.signInWithOtp({
        email: clean,
        options: { emailRedirectTo: redirect, shouldCreateUser: false },
      }))
      if (!err) setMessage('Check your email for a sign-in link.')
    }
    if (err) setError(err.message)
    setBusy(false)
  }

  return (
    <div className="narrow">
      <h1>Leader sign in</h1>
      <p className="muted">
        Team members don’t need an account — they just open the link you share with them.
      </p>
      <div className="segmented">
        <button className={mode === 'signin' ? 'on' : ''} onClick={() => setMode('signin')}>Sign in</button>
        <button className={mode === 'signup' ? 'on' : ''} onClick={() => setMode('signup')}>Create account</button>
        <button className={mode === 'link' ? 'on' : ''} onClick={() => setMode('link')}>Email link</button>
      </div>
      <form className="card form" onSubmit={submit}>
        <label>
          Email
          <input type="email" autoComplete="email" required value={email} onChange={(e) => setEmail(e.target.value)} />
        </label>
        {mode !== 'link' && (
          <label>
            Password
            <input
              type="password"
              autoComplete={mode === 'signup' ? 'new-password' : 'current-password'}
              minLength={6}
              required
              value={password}
              onChange={(e) => setPassword(e.target.value)}
            />
          </label>
        )}
        {error && <p className="error">{error}</p>}
        {message && <p className="notice">{message}</p>}
        <button className="btn primary" disabled={busy}>
          {busy ? 'Please wait…' : mode === 'signin' ? 'Sign in' : mode === 'signup' ? 'Create account' : 'Send link'}
        </button>
      </form>
      {mode === 'signup' && (
        <p className="muted small">
          Only email addresses on the Leaders list can edit songs and sets. Ask an existing leader to add you.
        </p>
      )}
    </div>
  )
}
