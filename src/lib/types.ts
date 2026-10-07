export interface Song {
  id: string
  title: string
  artist: string | null
  song_key: string | null
  tempo: number | null
  time_sig: string | null
  tags: string[]
  notes: string | null
  pdf_path: string | null
  pdf_name: string | null
  created_at: string
  updated_at: string
}

export interface EventRow {
  id: string
  share_id: string
  name: string
  event_date: string | null
  start_time: string | null
  location: string | null
  heart: string | null
  scripture: string | null
  prayer_points: string | null
  notes: string | null
  created_by_email: string | null
  created_at: string
  updated_at: string
}

export interface EventSongRow {
  song_id: string
  position: number
  song_key: string | null
  notes: string | null
}

export interface TeamMember {
  name: string
  role: string | null
}

/** A song as it appears inside a set (library data merged with per-set key/notes). */
export interface SetSong {
  id: string
  title: string
  artist: string | null
  song_key: string | null
  tempo: number | null
  time_sig: string | null
  notes: string | null
  pdf_path: string | null
}

export interface SharedEvent {
  id: string
  share_id: string
  name: string
  event_date: string | null
  start_time: string | null
  location: string | null
  heart: string | null
  scripture: string | null
  prayer_points: string | null
  notes: string | null
  updated_at: string
  team: TeamMember[]
  songs: SetSong[]
}
