import { lazy, Suspense, useEffect, useMemo, useRef, useState } from 'react'
import SongForm from '../components/SongForm'
import { createSong, fetchSongs } from '../lib/songs'
import { parseChartFileName } from '../lib/format'
import type { Song } from '../lib/types'

// pdf.js is large; load it only when someone opens the charts.
const Viewer = lazy(() => import('../components/Viewer'))

export function matchesSong(song: Song, query: string) {
  const q = query.trim().toLowerCase()
  if (!q) return true
  return [song.title, song.artist, song.song_key, ...song.tags]
    .filter(Boolean)
    .some((v) => v!.toLowerCase().includes(q))
}

export default function Library() {
  const [songs, setSongs] = useState<Song[] | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [query, setQuery] = useState('')
  const [editing, setEditing] = useState<Song | 'new' | null>(null)
  const [preview, setPreview] = useState<Song | null>(null)
  const [importing, setImporting] = useState<{ done: number; total: number; failed: string[] } | null>(null)
  const bulkInput = useRef<HTMLInputElement>(null)

  useEffect(() => {
    fetchSongs().then(setSongs, (e) => setError(e.message))
  }, [])

  const filtered = useMemo(() => (songs ?? []).filter((s) => matchesSong(s, query)), [songs, query])

  function upsertLocal(song: Song) {
    setSongs((list) => {
      const rest = (list ?? []).filter((s) => s.id !== song.id)
      return [...rest, song].sort((a, b) => a.title.localeCompare(b.title))
    })
    setEditing(null)
  }

  async function bulkImport(files: FileList | null) {
    if (!files?.length) return
    const all = Array.from(files)
    const state = { done: 0, total: all.length, failed: [] as string[] }
    setImporting({ ...state })
    // A few uploads at a time keeps mobile connections happy.
    const queue = [...all]
    async function worker() {
      for (let f = queue.shift(); f; f = queue.shift()) {
        const guess = parseChartFileName(f.name)
        try {
          const song = await createSong(
            { title: guess.title, song_key: guess.key, artist: null, tempo: null, time_sig: null, tags: [], notes: null },
            f,
          )
          setSongs((list) => [...(list ?? []), song].sort((a, b) => a.title.localeCompare(b.title)))
        } catch {
          state.failed.push(f.name)
        }
        state.done++
        setImporting({ ...state, failed: [...state.failed] })
      }
    }
    await Promise.all([worker(), worker(), worker()])
    if (bulkInput.current) bulkInput.current.value = ''
  }

  return (
    <div>
      <div className="page-head">
        <h1>Library</h1>
        <div className="actions">
          <button className="btn" onClick={() => bulkInput.current?.click()}>Import PDFs</button>
          <button className="btn primary" onClick={() => setEditing('new')}>+ Add song</button>
        </div>
        <input
          ref={bulkInput}
          type="file"
          accept="application/pdf,.pdf"
          multiple
          hidden
          onChange={(e) => bulkImport(e.target.files)}
        />
      </div>

      {importing && (
        <div className="card notice-card">
          {importing.done < importing.total
            ? `Importing ${importing.done + 1} of ${importing.total}…`
            : `Imported ${importing.total - importing.failed.length} of ${importing.total} charts.`}
          {importing.failed.length > 0 && <div className="error small">Failed: {importing.failed.join(', ')}</div>}
          {importing.done === importing.total && (
            <button className="btn ghost small" onClick={() => setImporting(null)}>Dismiss</button>
          )}
          <p className="muted small">Titles and keys are guessed from file names (e.g. “Way Maker - E.pdf”). Tap a song to fix details.</p>
        </div>
      )}

      <input
        className="search"
        type="search"
        placeholder={`Search ${songs?.length ?? ''} songs by title, artist, key or tag`}
        value={query}
        onChange={(e) => setQuery(e.target.value)}
      />

      {error && <p className="error">{error}</p>}
      {!songs ? (
        <p className="muted">Loading…</p>
      ) : songs.length === 0 ? (
        <p className="muted">Your library is empty. Add a song or import a batch of chart PDFs.</p>
      ) : (
        <ul className="list">
          {filtered.map((s) => (
            <li key={s.id} className="row">
              <button className="row-main" onClick={() => setEditing(s)}>
                <span className="row-title">{s.title}</span>
                <span className="muted small">
                  {[s.artist, s.tempo && `${s.tempo} bpm`, ...s.tags].filter(Boolean).join(' · ')}
                  {!s.pdf_path && <span className="warn"> · no chart</span>}
                </span>
              </button>
              {s.song_key && <span className="key">{s.song_key}</span>}
              {s.pdf_path && (
                <button className="btn ghost small" onClick={() => setPreview(s)}>View</button>
              )}
            </li>
          ))}
        </ul>
      )}

      {editing && (
        <SongForm
          song={editing === 'new' ? null : editing}
          onSaved={upsertLocal}
          onDeleted={(id) => {
            setSongs((list) => (list ?? []).filter((s) => s.id !== id))
            setEditing(null)
          }}
          onClose={() => setEditing(null)}
        />
      )}
      {preview && (
        <Suspense fallback={<div className="viewer"><div className="viewer-loading">Loading chart…</div></div>}>
          <Viewer songs={[preview]} onClose={() => setPreview(null)} />
        </Suspense>
      )}
    </div>
  )
}
