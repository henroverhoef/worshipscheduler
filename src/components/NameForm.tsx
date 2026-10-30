import { useEffect, useState, type FormEvent } from 'react'
import { useAuth } from '../auth'
import { saveMyName } from '../lib/people'

/** Edit the name co-leaders find you by. */
export default function NameForm({ onSaved }: { onSaved?: () => void }) {
  const { email, userId, displayName, refresh } = useAuth()
  const [name, setName] = useState(displayName ?? '')
  const [busy, setBusy] = useState(false)
  const [saved, setSaved] = useState(false)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => setName(displayName ?? ''), [displayName])

  async function save(e: FormEvent) {
    e.preventDefault()
    if (!email || !userId || !name.trim()) return
    setBusy(true)
    setError(null)
    try {
      await saveMyName(email, userId, name)
      await refresh()
      setSaved(true)
      setTimeout(() => setSaved(false), 2000)
      onSaved?.()
    } catch (err) {
      setError((err as Error).message)
    }
    setBusy(false)
  }

  return (
    <form className="inline-form" onSubmit={save}>
      <input
        required
        maxLength={60}
        autoComplete="name"
        placeholder="Your name"
        aria-label="Your name"
        value={name}
        onChange={(e) => setName(e.target.value)}
      />
      <button className="btn primary" disabled={busy || !name.trim() || name.trim() === displayName}>
        {saved ? 'Saved ✓' : busy ? '…' : 'Save'}
      </button>
      {error && <p className="error small">{error}</p>}
    </form>
  )
}
