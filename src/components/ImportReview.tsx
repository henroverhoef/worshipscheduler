import { useEffect, useMemo, useState } from 'react'
import { parseChartFileName } from '../lib/format'
import { createSong, findDuplicates, normText, songLabel, updateSong, type SongInput } from '../lib/songs'
import type { Song } from '../lib/types'

interface Row {
  id: string
  file: File
  pages: number | null
  /** The chart's words for lyrics search (undefined until read). */
  lyrics?: string | null
  title: string
  artist: string
  key: string
  tempo: string
  timeSig: string
  tags: string
  /** add = new song; replace = new chart (and details) for an existing song; skip = leave out. */
  action: 'add' | 'replace' | 'skip'
  replaceId: string | null
  status: 'idle' | 'saving' | 'done' | 'error'
  error?: string
}

interface Props {
  files: File[]
  library: Song[]
  onSaved: (song: Song) => void
  onClose: () => void
}

let seq = 0

/** Check and fill in details for imported chart PDFs before anything is uploaded. */
export default function ImportReview({ files, library, onSaved, onClose }: Props) {
  const [rows, setRows] = useState<Row[]>(() =>
    files.map((file) => {
      const guess = parseChartFileName(file.name)
      return {
        id: `r${++seq}`,
        file,
        pages: null,
        title: guess.title,
        artist: '',
        key: guess.key ?? '',
        tempo: '',
        timeSig: '',
        tags: '',
        action: 'add',
        replaceId: null,
        status: 'idle',
      }
    }),
  )
  const [allArtist, setAllArtist] = useState('')
  const [saving, setSaving] = useState(false)

  // Fill key / tempo / time from the PDF itself where the file name didn't say.
  useEffect(() => {
    let cancelled = false
    import('../lib/pdfDetails').then(({ readChartDetails }) => {
      for (const row of rows) {
        readChartDetails(row.file)
          .then((d) => {
            if (cancelled) return
            setRows((rs) =>
              rs.map((r) =>
                r.id !== row.id
                  ? r
                  : {
                      ...r,
                      pages: d.pages,
                      lyrics: d.lyrics,
                      key: r.key || d.key || '',
                      tempo: r.tempo || (d.tempo ? String(d.tempo) : ''),
                      timeSig: r.timeSig || d.timeSig || '',
                    },
              ),
            )
          })
          .catch(() => {
            if (!cancelled) setRows((rs) => rs.map((r) => (r.id === row.id ? { ...r, pages: 0 } : r)))
          })
      }
    })
    return () => {
      cancelled = true
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  const artists = useMemo(
    () => [...new Set(library.map((s) => s.artist).filter((a): a is string => !!a))].sort((a, b) => a.localeCompare(b)),
    [library],
  )
  const byId = useMemo(() => new Map(library.map((s) => [s.id, s])), [library])

  function update(id: string, patch: Partial<Row>) {
    setRows((rs) => rs.map((r) => (r.id === id ? { ...r, ...patch, status: r.status === 'done' ? 'done' : 'idle' } : r)))
  }

  function replaceWith(row: Row, song: Song) {
    // Keep the existing song's details unless this import says otherwise.
    update(row.id, {
      action: 'replace',
      replaceId: song.id,
      title: song.title,
      artist: row.artist || song.artist || '',
      key: row.key || song.song_key || '',
      tempo: row.tempo || (song.tempo ? String(song.tempo) : ''),
      timeSig: row.timeSig || song.time_sig || '',
      tags: row.tags || song.tags.join(', '),
    })
  }

  // What still needs sorting out before saving.
  const problems = useMemo(() => {
    const out = new Map<string, { library: Song[]; batch: boolean; missingTitle: boolean; missingArtist: boolean }>()
    const kept = rows.filter((r) => r.action !== 'skip' && r.status !== 'done')
    kept.forEach((r, i) => {
      const missingTitle = !r.title.trim()
      const missingArtist = !r.artist.trim()
      // For a replacement, the song being replaced doesn't count as a clash.
      const clashes = findDuplicates(r.title, r.artist || null, library, r.replaceId ?? undefined)
      // Two files in this import that would be the same song (the later one is flagged).
      const batch = kept.slice(0, i).some((o) => {
        if (normText(o.title) !== normText(r.title)) return false
        const a = normText(o.artist)
        const b = normText(r.artist)
        return !a || !b || a === b
      })
      if (missingTitle || missingArtist || clashes.length || batch)
        out.set(r.id, { library: clashes, batch, missingTitle, missingArtist })
    })
    return out
  }, [rows, library])

  const toSave = rows.filter((r) => r.action !== 'skip' && r.status !== 'done')
  const counts = {
    add: toSave.filter((r) => r.action === 'add').length,
    replace: toSave.filter((r) => r.action === 'replace').length,
    skip: rows.filter((r) => r.action === 'skip').length,
    done: rows.filter((r) => r.status === 'done').length,
  }
  const allDone = rows.every((r) => r.action === 'skip' || r.status === 'done')

  async function saveAll() {
    if (problems.size || !toSave.length) return
    setSaving(true)
    const queue = [...toSave]
    async function worker() {
      for (let r = queue.shift(); r; r = queue.shift()) {
        const row = r
        setRows((rs) => rs.map((x) => (x.id === row.id ? { ...x, status: 'saving', error: undefined } : x)))
        const input: SongInput = {
          title: row.title.trim(),
          artist: row.artist.trim() || null,
          song_key: row.key.trim() || null,
          tempo: row.tempo ? Number(row.tempo) : null,
          time_sig: row.timeSig.trim() || null,
          tags: row.tags.split(',').map((t) => t.trim()).filter(Boolean),
          notes: null,
        }
        try {
          const existing = row.replaceId ? byId.get(row.replaceId) : undefined
          const song =
            row.action === 'replace' && existing
              ? await updateSong(existing, { ...input, notes: existing.notes }, row.file, row.lyrics)
              : await createSong(input, row.file, row.lyrics)
          onSaved(song)
          setRows((rs) => rs.map((x) => (x.id === row.id ? { ...x, status: 'done' } : x)))
        } catch (e) {
          setRows((rs) => rs.map((x) => (x.id === row.id ? { ...x, status: 'error', error: (e as Error).message } : x)))
        }
      }
    }
    await Promise.all([worker(), worker(), worker()])
    setSaving(false)
  }

  function applyArtistToAll() {
    const a = allArtist.trim()
    if (!a) return
    setRows((rs) => rs.map((r) => (r.action !== 'skip' && r.status !== 'done' && !r.artist.trim() ? { ...r, artist: a } : r)))
    setAllArtist('')
  }

  return (
    <div className="sheet-backdrop" onClick={() => !saving && onClose()}>
      <div className="sheet import-review" onClick={(e) => e.stopPropagation()}>
        <div className="sheet-head">
          <h2>Review {rows.length === 1 ? 'chart' : `${rows.length} charts`}</h2>
          <button type="button" className="icon-btn" onClick={onClose} disabled={saving} aria-label="Close">✕</button>
        </div>
        <p className="muted small">
          Check the details before they’re added. Title and key are guessed from the file name and the chart itself.
        </p>

        <datalist id="import-artists">{artists.map((a) => <option key={a} value={a} />)}</datalist>
        {rows.length > 1 && (
          <div className="inline-form">
            <input
              list="import-artists"
              placeholder="Same artist for all (fills empty ones)"
              value={allArtist}
              onChange={(e) => setAllArtist(e.target.value)}
            />
            <button type="button" className="btn small" onClick={applyArtistToAll} disabled={!allArtist.trim()}>Apply</button>
          </div>
        )}

        <ol className="import-rows">
          {rows.map((r) => {
            const p = problems.get(r.id)
            const target = r.replaceId ? byId.get(r.replaceId) : undefined
            const locked = r.status === 'done' || r.status === 'saving' || saving
            return (
              <li key={r.id} className={`import-row ${r.action} ${p ? 'flagged' : ''} ${r.status}`}>
                <div className="import-file">
                  <span className="grow">
                    📄 {r.file.name}
                    {r.pages ? <span className="muted"> · {r.pages} page{r.pages === 1 ? '' : 's'}</span> : null}
                  </span>
                  {r.status === 'done' ? (
                    <span className="ok">✓ {r.action === 'replace' ? 'Replaced' : 'Added'}</span>
                  ) : r.status === 'saving' ? (
                    <span className="muted">Saving…</span>
                  ) : r.action === 'skip' ? (
                    <button type="button" className="btn ghost small" onClick={() => update(r.id, { action: 'add', replaceId: null })} disabled={saving}>
                      Include
                    </button>
                  ) : (
                    <button type="button" className="btn ghost small" onClick={() => update(r.id, { action: 'skip' })} disabled={saving}>
                      Skip
                    </button>
                  )}
                </div>

                {r.action === 'skip' ? (
                  <p className="muted small">Skipped — “{r.title || r.file.name}” won’t be added.</p>
                ) : (
                  <fieldset className="form import-fields" disabled={locked}>
                    {r.action === 'replace' && target && (
                      <p className="notice small replace-note">
                        ↻ Replaces the chart of {songLabel(target)}. Sets using it keep working with the new chart.{' '}
                        <button type="button" className="link-btn" onClick={() => update(r.id, { action: 'add', replaceId: null })}>
                          Add as a new song instead
                        </button>
                      </p>
                    )}
                    <label>
                      Title
                      <input value={r.title} onChange={(e) => update(r.id, { title: e.target.value })} required />
                    </label>
                    <label>
                      Artist
                      <input
                        list="import-artists"
                        required
                        value={r.artist}
                        placeholder="e.g. Bethel Music"
                        onChange={(e) => update(r.id, { artist: e.target.value })}
                      />
                    </label>
                    <div className="grid3">
                      <label>
                        Key
                        <input value={r.key} placeholder="e.g. G" onChange={(e) => update(r.id, { key: e.target.value })} />
                      </label>
                      <label>
                        BPM
                        <input type="number" min={20} max={300} value={r.tempo} onChange={(e) => update(r.id, { tempo: e.target.value })} />
                      </label>
                      <label>
                        Time
                        <input value={r.timeSig} placeholder="4/4" onChange={(e) => update(r.id, { timeSig: e.target.value })} />
                      </label>
                    </div>
                    <label>
                      Tags <span className="muted small">(comma separated)</span>
                      <input value={r.tags} placeholder="fast, communion" onChange={(e) => update(r.id, { tags: e.target.value })} />
                    </label>

                    {p?.missingTitle && <p className="error small">Give this song a title.</p>}
                    {p?.missingArtist && !p.missingTitle && <p className="warn small">Add the artist — every song needs one.</p>}
                    {p && p.library.length > 0 && (
                      <div className="dup-note">
                        <p className="small" style={{ margin: 0 }}>
                          ⚠ {p.library.length === 1 ? 'Already in the library' : 'The library already has'}:{' '}
                          {p.library.map(songLabel).join(', ')}.{' '}
                          {r.artist.trim() && p.library.every((s) => s.artist)
                            ? 'Change the title or artist,'
                            : 'If it’s a different song, add the artist to tell them apart,'}{' '}
                          or:
                        </p>
                        <div className="actions">
                          {p.library.map((s) => (
                            <button key={s.id} type="button" className="btn small" onClick={() => replaceWith(r, s)}>
                              Replace chart of {p.library.length > 1 ? songLabel(s) : 'that song'}
                            </button>
                          ))}
                          <button type="button" className="btn ghost small" onClick={() => update(r.id, { action: 'skip' })}>
                            Skip this file
                          </button>
                        </div>
                      </div>
                    )}
                    {p?.batch && (
                      <p className="warn small">
                        Another file in this import has the same title{r.artist ? ' and artist' : ''}. Change one, add
                        artists, or skip one.
                      </p>
                    )}
                    {r.status === 'error' && <p className="error small">{r.error}</p>}
                  </fieldset>
                )}
              </li>
            )
          })}
        </ol>

        <div className="import-foot">
          <span className="muted small grow">
            {allDone
              ? `Done — ${counts.done} saved${counts.skip ? `, ${counts.skip} skipped` : ''}.`
              : problems.size
                ? `${problems.size} need${problems.size === 1 ? 's' : ''} attention`
                : [
                    counts.add && `${counts.add} new`,
                    counts.replace && `${counts.replace} replaced`,
                    counts.skip && `${counts.skip} skipped`,
                  ]
                    .filter(Boolean)
                    .join(' · ')}
          </span>
          {allDone ? (
            <button type="button" className="btn primary" onClick={onClose}>Close</button>
          ) : (
            <>
              <button type="button" className="btn ghost" onClick={onClose} disabled={saving}>Cancel</button>
              <button
                type="button"
                className="btn primary"
                onClick={saveAll}
                disabled={saving || problems.size > 0 || toSave.length === 0}
              >
                {saving ? 'Saving…' : `Save ${toSave.length} to library`}
              </button>
            </>
          )}
        </div>
      </div>
    </div>
  )
}
