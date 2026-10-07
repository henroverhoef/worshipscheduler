import { formatDate } from '../lib/format'
import type { SharedEvent } from '../lib/types'

interface Props {
  event: SharedEvent
  onOpenSong: (index: number) => void
}

export default function EventDetails({ event, onOpenSong }: Props) {
  const when = [formatDate(event.event_date, { weekday: 'long', year: 'numeric' }), event.start_time]
    .filter(Boolean)
    .join(' · ')

  return (
    <article className="event narrow">
      <header className="event-head">
        <h1>{event.name}</h1>
        {when && <p className="event-when">{when}</p>}
        {event.location && <p className="muted">📍 {event.location}</p>}
      </header>

      {event.songs.length > 0 && (
        <button className="btn primary big" onClick={() => onOpenSong(0)}>
          Open charts ▸
        </button>
      )}

      {event.heart && (
        <section className="card prose">
          <h2>Heart for the set</h2>
          <p>{event.heart}</p>
        </section>
      )}
      {event.scripture && (
        <section className="card prose scripture">
          <h2>Scripture</h2>
          <p>{event.scripture}</p>
        </section>
      )}
      {event.prayer_points && (
        <section className="card prose">
          <h2>Prayer points</h2>
          <p>{event.prayer_points}</p>
        </section>
      )}

      <section className="card">
        <h2>Songs</h2>
        {event.songs.length === 0 ? (
          <p className="muted">No songs yet.</p>
        ) : (
          <ol className="setlist">
            {event.songs.map((s, i) => (
              <li key={s.id + i}>
                <button onClick={() => onOpenSong(i)}>
                  <span className="num">{i + 1}</span>
                  <span className="grow">
                    <span className="row-title">{s.title}</span>
                    {(s.artist || s.notes) && (
                      <span className="muted small">{[s.artist, s.notes].filter(Boolean).join(' — ')}</span>
                    )}
                  </span>
                  <span className="meta">
                    {s.song_key && <span className="key">{s.song_key}</span>}
                    {s.tempo && <span className="muted small">{s.tempo} bpm</span>}
                  </span>
                </button>
              </li>
            ))}
          </ol>
        )}
      </section>

      {event.team.length > 0 && (
        <section className="card">
          <h2>Team</h2>
          <ul className="team">
            {event.team.map((m, i) => (
              <li key={i}>
                <span className="role">{m.role || '—'}</span>
                <span>{m.name}</span>
              </li>
            ))}
          </ul>
        </section>
      )}

      {event.notes && (
        <section className="card prose">
          <h2>Notes</h2>
          <p>{event.notes}</p>
        </section>
      )}
    </article>
  )
}
