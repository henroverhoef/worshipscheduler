import { lazy, Suspense, useEffect, useMemo, useRef, useState } from 'react'
import { useSearchParams } from 'react-router-dom'
import SongForm from '../components/SongForm'
import ImportReview from '../components/ImportReview'
import { fetchSongs } from '../lib/songs'
import { takeSharedFiles } from '../lib/sharedFiles'
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
  // Chart PDFs waiting to be checked in the review sheet before they're uploaded.
  const [reviewing, setReviewing] = useState<File[] | null>(null)
  const bulkInput = useRef<HTMLInputElement>(null)
  const [params, setParams] = useSearchParams()
  // PDFs shared to the app from the phone's Share menu.
  const [sharedFile, setSharedFile] = useState<File | null>(null)
  const [shareError, setShareError] = useState<string | null>(null)

  useEffect(() => {
    const shared = params.get('shared')
    if (!shared) return
    setParams({}, { replace: true })
    if (shared === 'failed') {
      setShareError('That share didn’t come through. Open the app once, then share the PDF to it again.')
      return
    }
    takeSharedFiles().then((files) => {
      if (files.length === 0) setShareError('No PDF arrived from the share. Try sharing it again.')
      else if (files.length === 1) {
        setSharedFile(files[0])
        setEditing('new')
      } else setReviewing(files)
    })
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

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

  function upsertQuietly(song: Song) {
    setSongs((list) => [...(list ?? []).filter((s) => s.id !== song.id), song].sort((a, b) => a.title.localeCompare(b.title)))
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
          onChange={(e) => {
            const files = Array.from(e.target.files ?? [])
            if (files.length) setReviewing(files)
            e.target.value = ''
          }}
        />
      </div>

      {shareError && (
        <div className="card notice-card">
          {shareError}{' '}
          <button className="btn ghost small" onClick={() => setShareError(null)}>Dismiss</button>
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

      {reviewing && (
        <ImportReview files={reviewing} library={songs ?? []} onSaved={upsertQuietly} onClose={() => setReviewing(null)} />
      )}
      {editing && (
        <SongForm
          key={editing === 'new' ? 'new' : editing.id}
          song={editing === 'new' ? null : editing}
          initialFile={sharedFile ?? undefined}
          library={songs ?? []}
          existingAction={{
            label: sharedFile ? 'Replace its chart with this PDF' : 'Open that song instead',
            run: (existing, file) => {
              setSharedFile(file)
              setEditing(existing)
            },
          }}
          onSaved={(song) => {
            setSharedFile(null)
            upsertLocal(song)
          }}
          onDeleted={(id) => {
            setSongs((list) => (list ?? []).filter((s) => s.id !== id))
            setEditing(null)
          }}
          onClose={() => {
            setSharedFile(null)
            setEditing(null)
          }}
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
