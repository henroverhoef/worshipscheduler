import { useEffect, useMemo, useState, type FormEvent } from 'react'
import { Link, useNavigate, useParams, useSearchParams } from 'react-router-dom'
import SongForm from '../components/SongForm'
import { useAuth } from '../auth'
import { supabase } from '../lib/supabase'
import { fetchSongs } from '../lib/songs'
import { shareLink, shareText, shareUrl } from '../lib/format'
import { matchesSong } from './Library'
import type { EventRow, Song } from '../lib/types'

interface SetItem {
  key: string
  song_id: string
  song_key: string
  notes: string
}
interface TeamItem {
  key: string
  name: string
  role: string
}

const DEFAULT_ROLES = [
  'Worship leader',
  'Vocals',
  'Backing vocals',
  'Acoustic guitar',
  'Electric guitar',
  'Keys',
  'Piano',
  'Bass',
  'Drums',
  'Percussion',
  'Violin',
  'Sound',
  'Slides / Lyrics',
]

const blankEvent = {
  name: '',
  event_date: '',
  start_time: '',
  location: '',
  heart: '',
  scripture: '',
  prayer_points: '',
  notes: '',
}
type EventFields = typeof blankEvent

let keySeq = 0
const nextKey = () => `k${++keySeq}`

export default function EventEdit() {
  const { id } = useParams()
  const [params] = useSearchParams()
  const copyFrom = params.get('copy')
  const navigate = useNavigate()
  const { email: me } = useAuth()

  const [fields, setFields] = useState<EventFields>(blankEvent)
  const [saved, setSaved] = useState<EventRow | null>(null)
  const [items, setItems] = useState<SetItem[]>([])
  const [team, setTeam] = useState<TeamItem[]>([{ key: nextKey(), name: '', role: '' }])
  const [library, setLibrary] = useState<Song[]>([])
  const [pastPeople, setPastPeople] = useState<{ names: string[]; roles: string[] }>({ names: [], roles: [] })
  const [loading, setLoading] = useState(true)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [toast, setToast] = useState<string | null>(null)
  const [picking, setPicking] = useState(false)
  // Leaders who can see and edit this set, besides its creator.
  const [setLeaders, setSetLeaders] = useState<string[]>([])
  const [savedSetLeaders, setSavedSetLeaders] = useState<string[]>([])
  const [allLeaders, setAllLeaders] = useState<string[]>([])
  const [inviting, setInviting] = useState('')

  useEffect(() => {
    let cancelled = false
    async function load() {
      setLoading(true)
      const [songs, teamHistory, leaderRows] = await Promise.all([
        fetchSongs(),
        supabase.from('event_team').select('name, role').limit(1000),
        supabase.from('leaders').select('email').order('email'),
      ])
      if (cancelled) return
      setLibrary(songs)
      setAllLeaders((leaderRows.data ?? []).map((l) => l.email as string))
      const hist = teamHistory.data ?? []
      setPastPeople({
        names: [...new Set(hist.map((t) => t.name as string))].sort(),
        roles: [...new Set([...DEFAULT_ROLES, ...hist.map((t) => t.role as string).filter(Boolean)])],
      })

      const sourceId = id ?? copyFrom
      if (sourceId) {
        const { data, error } = await supabase
          .from('events')
          .select(
            '*, event_songs(song_id, position, song_key, notes), event_team(name, role, position), event_leaders(email)',
          )
          .eq('id', sourceId)
          .single()
        if (cancelled) return
        if (error || !data) {
          setError(error?.message ?? 'Set not found')
        } else {
          const ev = data as EventRow & {
            event_songs: { song_id: string; position: number; song_key: string | null; notes: string | null }[]
            event_team: { name: string; role: string | null; position: number }[]
            event_leaders: { email: string }[]
          }
          const invited = ev.event_leaders.map((l) => l.email)
          if (copyFrom) {
            // The copy belongs to whoever duplicates it; keep the original's leaders on it.
            const keep = [...invited, ev.created_by_email].filter((e): e is string => !!e && e !== me)
            setSetLeaders([...new Set(keep)])
          } else {
            setSetLeaders(invited)
            setSavedSetLeaders(invited)
          }
          setFields({
            name: copyFrom ? `${ev.name} (copy)` : ev.name,
            event_date: copyFrom ? '' : ev.event_date ?? '',
            start_time: ev.start_time ?? '',
            location: ev.location ?? '',
            heart: ev.heart ?? '',
            scripture: ev.scripture ?? '',
            prayer_points: ev.prayer_points ?? '',
            notes: ev.notes ?? '',
          })
          if (!copyFrom) setSaved(ev)
          setItems(
            [...ev.event_songs]
              .sort((a, b) => a.position - b.position)
              .map((s) => ({ key: nextKey(), song_id: s.song_id, song_key: s.song_key ?? '', notes: s.notes ?? '' })),
          )
          const t = [...ev.event_team].sort((a, b) => a.position - b.position)
          setTeam(
            t.length
              ? t.map((m) => ({ key: nextKey(), name: m.name, role: m.role ?? '' }))
              : [{ key: nextKey(), name: '', role: '' }],
          )
        }
      }
      setLoading(false)
    }
    load().catch((e) => {
      setError(e.message)
      setLoading(false)
    })
    return () => {
      cancelled = true
    }
  }, [id, copyFrom])

  const songById = useMemo(() => new Map(library.map((s) => [s.id, s])), [library])

  function set<K extends keyof EventFields>(k: K, v: EventFields[K]) {
    setFields((f) => ({ ...f, [k]: v }))
  }

  function move<T>(list: T[], from: number, to: number): T[] {
    if (to < 0 || to >= list.length) return list
    const copy = [...list]
    const [item] = copy.splice(from, 1)
    copy.splice(to, 0, item)
    return copy
  }

  async function save(e?: FormEvent) {
    e?.preventDefault()
    if (!fields.name.trim()) {
      setError('Give the set a name.')
      return
    }
    setBusy(true)
    setError(null)
    const payload = {
      name: fields.name.trim(),
      event_date: fields.event_date || null,
      start_time: fields.start_time.trim() || null,
      location: fields.location.trim() || null,
      heart: fields.heart.trim() || null,
      scripture: fields.scripture.trim() || null,
      prayer_points: fields.prayer_points.trim() || null,
      notes: fields.notes.trim() || null,
    }
    try {
      let ev: EventRow
      if (saved) {
        const { data, error } = await supabase
          .from('events')
          .update({ ...payload, updated_at: new Date().toISOString() })
          .eq('id', saved.id)
          .select()
          .single()
        if (error) throw error
        ev = data as EventRow
        const [a, b] = await Promise.all([
          supabase.from('event_songs').delete().eq('event_id', ev.id),
          supabase.from('event_team').delete().eq('event_id', ev.id),
        ])
        if (a.error) throw a.error
        if (b.error) throw b.error
      } else {
        const { data, error } = await supabase.from('events').insert(payload).select().single()
        if (error) throw error
        ev = data as EventRow
      }
      const songRows = items.map((it, i) => ({
        event_id: ev.id,
        song_id: it.song_id,
        position: i,
        song_key: it.song_key.trim() || null,
        notes: it.notes.trim() || null,
      }))
      const teamRows = team
        .filter((m) => m.name.trim())
        .map((m, i) => ({ event_id: ev.id, name: m.name.trim(), role: m.role.trim() || null, position: i }))
      const [s, t] = await Promise.all([
        songRows.length ? supabase.from('event_songs').insert(songRows) : Promise.resolve({ error: null }),
        teamRows.length ? supabase.from('event_team').insert(teamRows) : Promise.resolve({ error: null }),
      ])
      if (s.error) throw s.error
      if (t.error) throw t.error
      // Add new set leaders before removing old ones, so the person saving never loses access mid-save.
      const added = setLeaders.filter((e) => !savedSetLeaders.includes(e))
      const removed = savedSetLeaders.filter((e) => !setLeaders.includes(e))
      if (added.length) {
        const { error } = await supabase
          .from('event_leaders')
          .upsert(added.map((email) => ({ event_id: ev.id, email })), { ignoreDuplicates: true })
        if (error) throw error
      }
      if (removed.length) {
        const { error } = await supabase.from('event_leaders').delete().eq('event_id', ev.id).in('email', removed)
        if (error) throw error
      }
      setSavedSetLeaders(setLeaders)
      setSaved(ev)
      flash('Saved')
      if (!id) navigate(`/sets/${ev.id}`, { replace: true })
    } catch (err) {
      setError((err as Error).message)
    }
    setBusy(false)
  }

  function flash(msg: string) {
    setToast(msg)
    setTimeout(() => setToast(null), 2000)
  }

  async function share() {
    if (!saved) return
    const r = await shareLink(saved.name, shareUrl(saved.share_id), shareText(saved))
    if (r === 'copied') flash('Link copied')
  }

  async function remove() {
    if (!saved || !window.confirm(`Delete “${saved.name}”? The share link will stop working.`)) return
    const { error } = await supabase.from('events').delete().eq('id', saved.id)
    if (error) setError(error.message)
    else navigate('/')
  }

  if (loading) return <p className="muted">Loading…</p>

  const creator = saved?.created_by_email ?? null
  const invitable = allLeaders.filter((e) => e !== (creator ?? me) && !setLeaders.includes(e))

  return (
    <form className="editor" onSubmit={save}>
      <div className="page-head">
        <h1>{saved ? 'Edit set' : 'New set'}</h1>
        <div className="actions">
          {saved && (
            <>
              <Link to={`/s/${saved.share_id}`} className="btn ghost">Preview</Link>
              <button type="button" className="btn" onClick={share}>Share link</button>
            </>
          )}
          <button className="btn primary" disabled={busy}>{busy ? 'Saving…' : 'Save'}</button>
        </div>
      </div>
      {error && <p className="error">{error}</p>}

      <section className="card form">
        <label>
          Name
          <input required value={fields.name} onChange={(e) => set('name', e.target.value)} placeholder="Sunday morning, Youth night, Outreach…" />
        </label>
        <div className="grid2">
          <label>
            Date
            <input type="date" value={fields.event_date} onChange={(e) => set('event_date', e.target.value)} />
          </label>
          <label>
            Time
            <input value={fields.start_time} onChange={(e) => set('start_time', e.target.value)} placeholder="9:30 (soundcheck 8:00)" />
          </label>
        </div>
        <label>
          Location
          <input value={fields.location} onChange={(e) => set('location', e.target.value)} />
        </label>
      </section>

      <section className="card">
        <div className="section-head">
          <h2>Songs</h2>
          <button type="button" className="btn small" onClick={() => setPicking(true)}>+ Add songs</button>
        </div>
        {items.length === 0 && <p className="muted">No songs yet.</p>}
        <ol className="edit-list">
          {items.map((it, i) => {
            const song = songById.get(it.song_id)
            return (
              <li key={it.key}>
                <div className="edit-row">
                  <span className="num">{i + 1}</span>
                  <div className="grow">
                    <div className="row-title">{song?.title ?? 'Deleted song'}</div>
                    <div className="inline-fields">
                      <input
                        className="key-input"
                        aria-label="Key for this set"
                        placeholder={song?.song_key ?? 'Key'}
                        value={it.song_key}
                        onChange={(e) =>
                          setItems(items.map((x) => (x.key === it.key ? { ...x, song_key: e.target.value } : x)))
                        }
                      />
                      <input
                        className="grow"
                        aria-label="Notes for this song"
                        placeholder="Notes (e.g. start acoustic, 2x chorus)"
                        value={it.notes}
                        onChange={(e) =>
                          setItems(items.map((x) => (x.key === it.key ? { ...x, notes: e.target.value } : x)))
                        }
                      />
                    </div>
                  </div>
                  <div className="reorder">
                    <button type="button" className="icon-btn" aria-label="Move up" onClick={() => setItems(move(items, i, i - 1))}>↑</button>
                    <button type="button" className="icon-btn" aria-label="Move down" onClick={() => setItems(move(items, i, i + 1))}>↓</button>
                    <button type="button" className="icon-btn" aria-label="Remove" onClick={() => setItems(items.filter((x) => x.key !== it.key))}>✕</button>
                  </div>
                </div>
              </li>
            )
          })}
        </ol>
      </section>

      <section className="card form">
        <h2>Heart, scripture & prayer</h2>
        <label>
          Heart for the set
          <textarea rows={4} value={fields.heart} onChange={(e) => set('heart', e.target.value)} placeholder="What do we want to lead people into?" />
        </label>
        <label>
          Scripture
          <textarea rows={3} value={fields.scripture} onChange={(e) => set('scripture', e.target.value)} placeholder="Psalm 96:1–3 …" />
        </label>
        <label>
          Prayer points
          <textarea rows={4} value={fields.prayer_points} onChange={(e) => set('prayer_points', e.target.value)} />
        </label>
      </section>

      <section className="card">
        <h2>Leaders for this set</h2>
        <p className="muted small">
          Only these leaders see this set in their app and can edit it. Your team still just gets the share link.
        </p>
        <ul className="chips">
          <li className="chip-item">
            {creator ?? me}
            <span className="muted small">{creator && creator !== me ? 'created it' : 'you · created it'}</span>
          </li>
          {setLeaders.map((email) => (
            <li key={email} className="chip-item">
              {email}
              {email === me ? (
                <span className="muted small">you</span>
              ) : (
                <button
                  type="button"
                  className="icon-btn"
                  aria-label={`Remove ${email} from this set`}
                  onClick={() => setSetLeaders(setLeaders.filter((x) => x !== email))}
                >
                  ✕
                </button>
              )}
            </li>
          ))}
        </ul>
        {invitable.length > 0 ? (
          <div className="inline-form">
            <select value={inviting} onChange={(e) => setInviting(e.target.value)} aria-label="Leader to add">
              <option value="">Add a leader to this set…</option>
              {invitable.map((email) => (
                <option key={email} value={email}>{email}</option>
              ))}
            </select>
            <button
              type="button"
              className="btn"
              disabled={!inviting}
              onClick={() => {
                setSetLeaders([...setLeaders, inviting])
                setInviting('')
              }}
            >
              Add
            </button>
          </div>
        ) : (
          <p className="muted small">
            {allLeaders.length <= 1 ? 'Add more leaders on the Leaders page first.' : 'All leaders are on this set.'}
          </p>
        )}
      </section>

      <section className="card">
        <div className="section-head">
          <h2>Team</h2>
          <button type="button" className="btn small" onClick={() => setTeam([...team, { key: nextKey(), name: '', role: '' }])}>+ Add person</button>
        </div>
        <datalist id="people">{pastPeople.names.map((n) => <option key={n} value={n} />)}</datalist>
        <datalist id="roles">{pastPeople.roles.map((r) => <option key={r} value={r} />)}</datalist>
        <ul className="edit-list">
          {team.map((m, i) => (
            <li key={m.key} className="edit-row">
              <input
                list="roles"
                className="role-input"
                placeholder="Instrument / role"
                value={m.role}
                onChange={(e) => setTeam(team.map((x) => (x.key === m.key ? { ...x, role: e.target.value } : x)))}
              />
              <input
                list="people"
                className="grow"
                placeholder="Name"
                value={m.name}
                onChange={(e) => setTeam(team.map((x) => (x.key === m.key ? { ...x, name: e.target.value } : x)))}
              />
              <div className="reorder">
                <button type="button" className="icon-btn" aria-label="Move up" onClick={() => setTeam(move(team, i, i - 1))}>↑</button>
                <button type="button" className="icon-btn" aria-label="Remove" onClick={() => setTeam(team.filter((x) => x.key !== m.key))}>✕</button>
              </div>
            </li>
          ))}
        </ul>
      </section>

      <section className="card form">
        <label>
          Other notes
          <textarea rows={3} value={fields.notes} onChange={(e) => set('notes', e.target.value)} placeholder="Rehearsal times, dress code, parking…" />
        </label>
      </section>

      <div className="editor-foot">
        {saved && (
          <>
            <button type="button" className="btn danger" onClick={remove}>Delete set</button>
            <Link to={`/sets/new?copy=${saved.id}`} className="btn ghost">Duplicate</Link>
          </>
        )}
        <span className="grow" />
        <button className="btn primary" disabled={busy}>{busy ? 'Saving…' : 'Save'}</button>
      </div>

      {picking && (
        <SongPicker
          library={library}
          chosen={items.map((i) => i.song_id)}
          onAdd={(song) => setItems((list) => [...list, { key: nextKey(), song_id: song.id, song_key: '', notes: '' }])}
          onCreated={(song) => setLibrary((l) => [...l, song].sort((a, b) => a.title.localeCompare(b.title)))}
          onClose={() => setPicking(false)}
        />
      )}
      {toast && <div className="toast">{toast}</div>}
    </form>
  )
}

interface PickerProps {
  library: Song[]
  chosen: string[]
  onAdd: (song: Song) => void
  onCreated: (song: Song) => void
  onClose: () => void
}

function SongPicker({ library, chosen, onAdd, onCreated, onClose }: PickerProps) {
  const [query, setQuery] = useState('')
  const [creating, setCreating] = useState(false)
  const filtered = library.filter((s) => matchesSong(s, query))

  if (creating) {
    return (
      <SongForm
        song={null}
        onSaved={(song) => {
          onCreated(song)
          onAdd(song)
          setCreating(false)
        }}
        onDeleted={() => {}}
        onClose={() => setCreating(false)}
      />
    )
  }

  return (
    <div className="sheet-backdrop" onClick={onClose}>
      <div className="sheet picker" onClick={(e) => e.stopPropagation()}>
        <div className="sheet-head">
          <h2>Add songs</h2>
          <button type="button" className="btn primary small" onClick={onClose}>Done</button>
        </div>
        <input
          className="search"
          type="search"
          autoFocus
          placeholder="Search library"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
        />
        <ul className="list picker-list">
          {filtered.map((s) => {
            const count = chosen.filter((c) => c === s.id).length
            return (
              <li key={s.id} className="row">
                <button type="button" className="row-main" onClick={() => onAdd(s)}>
                  <span className="row-title">{s.title}</span>
                  <span className="muted small">{[s.artist, ...s.tags].filter(Boolean).join(' · ')}</span>
                </button>
                {s.song_key && <span className="key">{s.song_key}</span>}
                <span className={`added ${count ? 'on' : ''}`}>{count ? `✓${count > 1 ? count : ''}` : '+'}</span>
              </li>
            )
          })}
        </ul>
        <button type="button" className="btn ghost" onClick={() => setCreating(true)}>+ New song not in library</button>
      </div>
    </div>
  )
}
