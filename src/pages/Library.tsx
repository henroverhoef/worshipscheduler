import { lazy, Suspense, useEffect, useMemo, useRef, useState } from 'react'
import { useSearchParams } from 'react-router-dom'
import SongForm from '../components/SongForm'
import ImportReview from '../components/ImportReview'
import { fetchSongs, normText } from '../lib/songs'
import { indexMissingLyrics, splitSnippet, useLyricSearch } from '../lib/lyrics'
import { takeSharedFiles } from '../lib/sharedFiles'
import type { Song } from '../lib/types'

// pdf.js is large; load it only when someone opens the charts.
const Viewer = lazy(() => import('../components/Viewer'))

export function matchesSong(song: Song, query: string) {
  return songRank(song, query) > 0
}

/** How well a song matches the search: title first, then artist, key and tags (0 = no match). */
export function songRank(song: Song, query: string) {
  const q = normText(query)
  if (!q) return 1
  const title = normText(song.title)
  if (title === q) return 6
  if (title.startsWith(q)) return 5
  if (` ${title}`.includes(` ${q}`)) return 4
  if (title.includes(q)) return 3
  if (normText(song.artist).includes(q)) return 2
  if ([song.song_key, ...song.tags].some((v) => normText(v).includes(q))) return 1
  return 0
}

/** Songs matching the search, best title matches first. */
export function rankSongs(songs: Song[], query: string) {
  if (!query.trim()) return songs
  return songs
    .map((s) => [s, songRank(s, query)] as const)
    .filter(([, r]) => r > 0)
    .sort((a, b) => b[1] - a[1] || a[0].title.localeCompare(b[0].title))
    .map(([s]) => s)
}

/** A lyrics hit: song title plus the matching line, with the matched words highlighted. */
export function LyricSnippet({ snippet, query }: { snippet: string; query: string }) {
  const [before, match, after] = splitSnippet(snippet, query)
  return (
    <span className="lyric-snippet">
      …{before}
      <mark>{match}</mark>
      {after}…
    </span>
  )
}

export default function Library() {
  const [songs, setSongs] = useState<Song[] | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [query, setQuery] = useState('')
  const [needsArtist, setNeedsArtist] = useState(false)
  const [indexProgress, setIndexProgress] = useState<{ done: number; total: number } | null>(null)
  const lyricSearch = useLyricSearch(query)
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
    // Read the words of older charts once, in the background, so lyrics search covers them.
    indexMissingLyrics((done, total) => setIndexProgress(done < total ? { done, total } : null)).catch(() => {})
  }, [])

  const missingArtist = useMemo(() => (songs ?? []).filter((s) => !s.artist?.trim()), [songs])
  const filtered = useMemo(
    () => rankSongs(needsArtist ? missingArtist : songs ?? [], query),
    [songs, missingArtist, needsArtist, query],
  )
  const byId = useMemo(() => new Map((songs ?? []).map((s) => [s.id, s])), [songs])
  // Songs found only by their words (title matches are already listed above them).
  const lyricOnly = useMemo(() => {
    const shown = new Set(filtered.map((s) => s.id))
    return lyricSearch.hits
      .filter((h) => !shown.has(h.id) && byId.has(h.id))
      .map((h) => ({ song: byId.get(h.id)!, snippet: h.snippet }))
  }, [lyricSearch.hits, filtered, byId])

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
        placeholder={`Search ${songs?.length ?? ''} songs by title, artist or lyrics`}
        value={query}
        onChange={(e) => setQuery(e.target.value)}
      />
      {(missingArtist.length > 0 || indexProgress) && (
        <div className="library-notes">
          {missingArtist.length > 0 && (
            <button className={`chip-filter ${needsArtist ? 'on' : ''}`} onClick={() => setNeedsArtist(!needsArtist)}>
              {needsArtist ? '✓ ' : ''}
              {missingArtist.length} song{missingArtist.length === 1 ? '' : 's'} need{missingArtist.length === 1 ? 's' : ''} an artist
            </button>
          )}
          {indexProgress && (
            <span className="muted small">
              Reading lyrics from older charts for search… {indexProgress.done}/{indexProgress.total}
            </span>
          )}
        </div>
      )}

      {error && <p className="error">{error}</p>}
      {!songs ? (
        <p className="muted">Loading…</p>
      ) : songs.length === 0 ? (
        <p className="muted">Your library is empty. Add a song or import a batch of chart PDFs.</p>
      ) : filtered.length === 0 ? null : (
        <ul className="list">
          {filtered.map((s) => (
            <li key={s.id} className="row">
              <button className="row-main" onClick={() => setEditing(s)}>
                <span className="row-title">{s.title}</span>
                <span className="muted small">
                  {[s.artist, s.tempo && `${s.tempo} bpm`, ...s.tags].filter(Boolean).join(' · ')}
                  {!s.artist?.trim() && <span className="warn">no artist</span>}
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

      {query.trim() && (lyricSearch.searching || lyricOnly.length > 0) && (
        <>
          <h2 className="section-label">Found in the lyrics</h2>
          {lyricOnly.length > 0 ? (
            <ul className="list">
              {lyricOnly.map(({ song: s, snippet }) => (
                <li key={s.id} className="row">
                  <button className="row-main" onClick={() => setEditing(s)}>
                    <span className="row-title">{s.title}</span>
                    <span className="muted small">{s.artist}</span>
                    <LyricSnippet snippet={snippet} query={query} />
                  </button>
                  {s.song_key && <span className="key">{s.song_key}</span>}
                  {s.pdf_path && (
                    <button className="btn ghost small" onClick={() => setPreview(s)}>View</button>
                  )}
                </li>
              ))}
            </ul>
          ) : (
            <p className="muted small">Searching the lyrics…</p>
          )}
        </>
      )}
      {query.trim() && !lyricSearch.searching && filtered.length === 0 && lyricOnly.length === 0 && songs && (
        <p className="muted">No songs match “{query.trim()}”.</p>
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
