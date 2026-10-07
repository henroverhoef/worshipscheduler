import { useEffect, useState, type FormEvent } from 'react'
import { useAuth } from '../auth'
import { supabase } from '../lib/supabase'

export default function Leaders() {
  const { email: me } = useAuth()
  const [leaders, setLeaders] = useState<string[]>([])
  const [email, setEmail] = useState('')
  const [error, setError] = useState<string | null>(null)

  async function load() {
    const { data, error } = await supabase.from('leaders').select('email').order('added_at')
    if (error) setError(error.message)
    else setLeaders(data.map((l) => l.email as string))
  }

  useEffect(() => {
    load()
  }, [])

  async function add(e: FormEvent) {
    e.preventDefault()
    setError(null)
    const clean = email.trim().toLowerCase()
    const { error } = await supabase.from('leaders').insert({ email: clean })
    if (error) setError(error.code === '23505' ? 'Already a leader.' : error.message)
    else {
      setEmail('')
      load()
    }
  }

  async function remove(target: string) {
    if (!window.confirm(`Remove ${target} as a leader?`)) return
    const { error } = await supabase.from('leaders').delete().eq('email', target)
    if (error) setError(error.message)
    else load()
  }

  return (
    <div className="narrow">
      <h1>Leaders</h1>
      <p className="muted">
        Leaders can add songs and create, edit and share sets. To add a co-leader, put their email here, then ask
        them to <strong>create an account</strong> with that same email on the sign-in page.
      </p>
      <form className="card inline-form" onSubmit={add}>
        <input type="email" required placeholder="name@example.com" value={email} onChange={(e) => setEmail(e.target.value)} />
        <button className="btn primary">Add</button>
      </form>
      {error && <p className="error">{error}</p>}
      <ul className="list">
        {leaders.map((l) => (
          <li key={l} className="row">
            <span className="row-main">
              <span className="row-title">{l}</span>
              {l === me && <span className="muted small">you</span>}
            </span>
            {l !== me && (
              <button className="btn ghost small" onClick={() => remove(l)}>Remove</button>
            )}
          </li>
        ))}
      </ul>
    </div>
  )
}
