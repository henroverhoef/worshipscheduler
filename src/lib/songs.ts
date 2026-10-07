import { supabase, CHARTS_BUCKET } from './supabase'
import type { Song } from './types'

export async function fetchSongs(): Promise<Song[]> {
  const { data, error } = await supabase.from('songs').select('*').order('title')
  if (error) throw error
  return data as Song[]
}

/** Uploads a chart under a fresh random path (paths are never reused, so cached copies stay valid). */
export async function uploadChart(file: File): Promise<string> {
  const path = `${crypto.randomUUID()}.pdf`
  const { error } = await supabase.storage.from(CHARTS_BUCKET).upload(path, file, {
    contentType: 'application/pdf',
    cacheControl: '31536000',
  })
  if (error) throw error
  return path
}

export async function removeChart(path: string | null) {
  if (path) await supabase.storage.from(CHARTS_BUCKET).remove([path])
}

export type SongInput = Pick<Song, 'title' | 'artist' | 'song_key' | 'tempo' | 'time_sig' | 'tags' | 'notes'>

export async function createSong(input: SongInput, file: File | null): Promise<Song> {
  const pdf_path = file ? await uploadChart(file) : null
  const { data, error } = await supabase
    .from('songs')
    .insert({ ...input, pdf_path, pdf_name: file?.name ?? null })
    .select()
    .single()
  if (error) {
    await removeChart(pdf_path)
    throw error
  }
  return data as Song
}

export async function updateSong(song: Song, input: SongInput, file: File | null): Promise<Song> {
  const patch: Partial<Song> = { ...input, updated_at: new Date().toISOString() }
  if (file) {
    patch.pdf_path = await uploadChart(file)
    patch.pdf_name = file.name
  }
  const { data, error } = await supabase.from('songs').update(patch).eq('id', song.id).select().single()
  if (error) {
    if (file) await removeChart(patch.pdf_path ?? null)
    throw error
  }
  if (file) await removeChart(song.pdf_path)
  return data as Song
}

export async function songUsage(songId: string): Promise<number> {
  const { count } = await supabase
    .from('event_songs')
    .select('id', { count: 'exact', head: true })
    .eq('song_id', songId)
  return count ?? 0
}

export async function deleteSong(song: Song) {
  const { error } = await supabase.from('songs').delete().eq('id', song.id)
  if (error) throw error
  await removeChart(song.pdf_path)
}
