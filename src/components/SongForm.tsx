import { useEffect, useState, type FormEvent } from 'react'
import { createSong, deleteSong, findDuplicates, songLabel, songUsage, updateSong, type SongInput } from '../lib/songs'
import { parseChartFileName, songSelectSearchUrl } from '../lib/format'
import type { Song } from '../lib/types'

interface Props {
  song: Song | null
  /** Pre-filled title for a new song (e.g. what was typed in the song search). */
  initialTitle?: string
  /** Pre-attached chart for a new song (e.g. a PDF shared to the app). */
  initialFile?: File
  /** Used to stop a song being added (or renamed) twice. */
  library?: Song[]
  /** What to offer when the song already exists, e.g. open it instead, or add it to the set. */
  existingAction?: { label: string; run: (existing: Song, file: File | null) => void }
  onSaved: (song: Song) => void
  onDeleted: (id: string) => void
  onClose: () => void
}

export default function SongForm({ song, initialTitle, initialFile, library, existingAction, onSaved, onDeleted, onClose }: Props) {
  const guess = initialFile ? parseChartFileName(initialFile.name) : null
  const [title, setTitle] = useState(song?.title ?? initialTitle ?? guess?.title ?? '')
  const [artist, setArtist] = useState(song?.artist ?? '')
  const [key, setKey] = useState(song?.song_key ?? guess?.key ?? '')
  const [tempo, setTempo] = useState(song?.tempo?.toString() ?? '')
  const [timeSig, setTimeSig] = useState(song?.time_sig ?? '')
  const [tags, setTags] = useState(song?.tags.join(', ') ?? '')
  const [notes, setNotes] = useState(song?.notes ?? '')
  const [file, setFile] = useState<File | null>(initialFile ?? null)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  function pickFile(f: File | null) {
    setFile(f)
    if (!f) return
    const guess = parseChartFileName(f.name)
    if (!title) setTitle(guess.title)
    if (guess.key && !key) setKey(guess.key)
    // Fill key / tempo / time from the chart itself where it prints them.
    import('../lib/pdfDetails')
      .then(({ readChartDetails }) => readChartDetails(f))
      .then((d) => {
        if (d.key) setKey((k) => k || d.key!)
        if (d.tempo) setTempo((t) => t || String(d.tempo))
        if (d.timeSig) setTimeSig((t) => t || d.timeSig!)
      })
      .catch(() => {})
  }

  // Shared PDFs arrive pre-attached: read their details too.
  useEffect(() => {
    if (initialFile && !song) pickFile(initialFile)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  const duplicates = library ? findDuplicates(title, artist.trim() || null, library, song?.id) : []
  // If an artist would tell them apart, say so; otherwise it's simply already there.
  const canDisambiguate = duplicates.some((d) => !d.artist) || !artist.trim()

  async function submit(e: FormEvent) {
    e.preventDefault()
    if (!artist.trim()) {
      setError('Add the artist — every song needs one.')
      return
    }
    if (duplicates.length) {
      setError(
        canDisambiguate
          ? 'This might already be in the library. If it’s a different song, add the artist (or change the title).'
          : 'This song is already in the library. Change the title or artist.',
      )
      return
    }
    setBusy(true)
    setError(null)
    const input: SongInput = {
      title: title.trim(),
      artist: artist.trim() || null,
      song_key: key.trim() || null,
      tempo: tempo ? Number(tempo) : null,
      time_sig: timeSig.trim() || null,
      tags: tags.split(',').map((t) => t.trim()).filter(Boolean),
      notes: notes.trim() || null,
    }
    try {
      // Read the chart's words now so it's searchable straight away (the background reader catches failures).
      let lyrics: string | null | undefined
      if (file) {
        lyrics = await import('../lib/pdfDetails')
          .then(({ readChartDetails }) => readChartDetails(file))
          .then((d) => d.lyrics)
          .catch(() => undefined)
      }
      onSaved(song ? await updateSong(song, input, file, lyrics) : await createSong(input, file, lyrics))
    } catch (err) {
      setError((err as Error).message)
      setBusy(false)
    }
  }

  async function remove() {
    if (!song) return
    const used = await songUsage(song.id)
    const msg = used
      ? `“${song.title}” is used in ${used} set${used === 1 ? '' : 's'}. Deleting it removes it from those sets too. Delete anyway?`
      : `Delete “${song.title}” and its chart?`
    if (!window.confirm(msg)) return
    setBusy(true)
    try {
      await deleteSong(song)
      onDeleted(song.id)
    } catch (err) {
      setError((err as Error).message)
      setBusy(false)
    }
  }

  return (
    <div className="sheet-backdrop" onClick={onClose}>
      <form className="sheet form" onSubmit={submit} onClick={(e) => e.stopPropagation()}>
        <div className="sheet-head">
          <h2>{song ? 'Edit song' : 'Add song'}</h2>
          <button type="button" className="icon-btn" onClick={onClose} aria-label="Close">✕</button>
        </div>
        {!song && !file && (
          <p className="muted small songselect-hint">
            No chart yet?{' '}
            <a
              href={songSelectSearchUrl(title || 'chord chart')}
              target="_blank"
              rel="noreferrer"
              onClick={(e) => {
                if (!title.trim()) {
                  e.preventDefault()
                  setError('Type the song title first, then tap Find on SongSelect.')
                }
              }}
            >
              Find {title.trim() ? `“${title.trim()}”` : 'it'} on SongSelect ↗
            </a>
            , download the PDF there, then pick it below.
          </p>
        )}
        <label>
          Chart PDF {song?.pdf_name && !file && <span className="muted small">— current: {song.pdf_name}</span>}
          {file && initialFile === file ? (
            <span className="shared-file">
              📄 {song ? 'New chart: ' : ''}{file.name}
              <button type="button" className="btn ghost small" onClick={() => setFile(null)}>Change</button>
            </span>
          ) : (
            <input type="file" accept="application/pdf,.pdf" onChange={(e) => pickFile(e.target.files?.[0] ?? null)} />
          )}
        </label>
        <label>
          Title
          <input required value={title} onChange={(e) => setTitle(e.target.value)} />
        </label>
        {duplicates.length > 0 && (
          <div className="dup-note">
            <p className="small" style={{ margin: 0 }}>
              ⚠ {duplicates.length === 1 ? 'Already in the library' : 'The library already has'}:{' '}
              {duplicates.map(songLabel).join(', ')}.{' '}
              {canDisambiguate ? 'If this is a different song, add the artist to tell them apart.' : 'Change the title or artist.'}
            </p>
            {existingAction && (
              <div className="actions">
                {duplicates.map((d) => (
                  <button key={d.id} type="button" className="btn small" onClick={() => existingAction.run(d, file)}>
                    {existingAction.label}
                    {duplicates.length > 1 ? `: ${songLabel(d)}` : ''}
                  </button>
                ))}
              </div>
            )}
          </div>
        )}
        <label>
          Artist
          <input
            list="song-artists"
            required
            value={artist}
            onChange={(e) => setArtist(e.target.value)}
            placeholder="e.g. Bethel Music"
          />
        </label>
        <datalist id="song-artists">
          {[...new Set((library ?? []).map((s) => s.artist).filter((a): a is string => !!a))].sort().map((a) => (
            <option key={a} value={a} />
          ))}
        </datalist>
        <div className="grid3">
          <label>
            Key
            <input value={key} onChange={(e) => setKey(e.target.value)} placeholder="e.g. G" />
          </label>
          <label>
            BPM
            <input type="number" min={20} max={300} value={tempo} onChange={(e) => setTempo(e.target.value)} />
          </label>
          <label>
            Time
            <input value={timeSig} onChange={(e) => setTimeSig(e.target.value)} placeholder="4/4" />
          </label>
        </div>
        <label>
          Tags <span className="muted small">(comma separated)</span>
          <input value={tags} onChange={(e) => setTags(e.target.value)} placeholder="fast, communion, christmas" />
        </label>
        <label>
          Notes
          <textarea rows={3} value={notes} onChange={(e) => setNotes(e.target.value)} />
        </label>
        {error && <p className="error">{error}</p>}
        <div className="sheet-actions">
          {song && (
            <button type="button" className="btn danger" onClick={remove} disabled={busy}>Delete</button>
          )}
          <span className="grow" />
          <button type="button" className="btn ghost" onClick={onClose}>Cancel</button>
          <button className="btn primary" disabled={busy}>{busy ? 'Saving…' : 'Save'}</button>
        </div>
      </form>
    </div>
  )
}
