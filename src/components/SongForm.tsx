import { useState, type FormEvent } from 'react'
import { createSong, deleteSong, songUsage, updateSong, type SongInput } from '../lib/songs'
import { parseChartFileName } from '../lib/format'
import type { Song } from '../lib/types'

interface Props {
  song: Song | null
  onSaved: (song: Song) => void
  onDeleted: (id: string) => void
  onClose: () => void
}

export default function SongForm({ song, onSaved, onDeleted, onClose }: Props) {
  const [title, setTitle] = useState(song?.title ?? '')
  const [artist, setArtist] = useState(song?.artist ?? '')
  const [key, setKey] = useState(song?.song_key ?? '')
  const [tempo, setTempo] = useState(song?.tempo?.toString() ?? '')
  const [timeSig, setTimeSig] = useState(song?.time_sig ?? '')
  const [tags, setTags] = useState(song?.tags.join(', ') ?? '')
  const [notes, setNotes] = useState(song?.notes ?? '')
  const [file, setFile] = useState<File | null>(null)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  function pickFile(f: File | null) {
    setFile(f)
    if (f && !title) {
      const guess = parseChartFileName(f.name)
      setTitle(guess.title)
      if (guess.key && !key) setKey(guess.key)
    }
  }

  async function submit(e: FormEvent) {
    e.preventDefault()
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
      onSaved(song ? await updateSong(song, input, file) : await createSong(input, file))
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
        <label>
          Chart PDF {song?.pdf_name && !file && <span className="muted small">— current: {song.pdf_name}</span>}
          <input type="file" accept="application/pdf,.pdf" onChange={(e) => pickFile(e.target.files?.[0] ?? null)} />
        </label>
        <label>
          Title
          <input required value={title} onChange={(e) => setTitle(e.target.value)} />
        </label>
        <label>
          Artist
          <input value={artist} onChange={(e) => setArtist(e.target.value)} />
        </label>
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
