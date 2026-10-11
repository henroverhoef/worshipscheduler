-- Markings (pen, highlighter, text notes) a set's leaders draw on its charts.
-- Stored per set + song + page as vector data on top of the untouched library PDF.

create table public.set_annotations (
  event_id uuid not null references public.events (id) on delete cascade,
  song_id uuid not null references public.songs (id) on delete cascade,
  page integer not null check (page >= 1),
  items jsonb not null default '[]'::jsonb,
  updated_at timestamptz not null default now(),
  primary key (event_id, song_id, page)
);
create index set_annotations_song_idx on public.set_annotations (song_id);
alter table public.set_annotations enable row level security;

create policy "set leaders manage annotations" on public.set_annotations
  for all to authenticated using (public.can_access_event(event_id)) with check (public.can_access_event(event_id));

-- Share links also return the set's markings so the team sees them.
create or replace function public.get_shared_event(p_share_id text)
returns jsonb
language sql stable security definer set search_path = ''
as $$
  select jsonb_build_object(
    'id', e.id,
    'share_id', e.share_id,
    'name', e.name,
    'event_date', e.event_date,
    'start_time', e.start_time,
    'location', e.location,
    'heart', e.heart,
    'scripture', e.scripture,
    'prayer_points', e.prayer_points,
    'notes', e.notes,
    'updated_at', e.updated_at,
    'team', coalesce((
      select jsonb_agg(jsonb_build_object('name', t.name, 'role', t.role) order by t.position)
      from public.event_team t where t.event_id = e.id
    ), '[]'::jsonb),
    'songs', coalesce((
      select jsonb_agg(jsonb_build_object(
        'id', s.id, 'title', s.title, 'artist', s.artist,
        'song_key', coalesce(es.song_key, s.song_key), 'tempo', s.tempo, 'time_sig', s.time_sig,
        'notes', es.notes, 'pdf_path', s.pdf_path, 'updated_at', s.updated_at
      ) order by es.position)
      from public.event_songs es join public.songs s on s.id = es.song_id
      where es.event_id = e.id
    ), '[]'::jsonb),
    'annotations', coalesce((
      select jsonb_agg(jsonb_build_object('song_id', a.song_id, 'page', a.page, 'items', a.items))
      from public.set_annotations a where a.event_id = e.id
    ), '[]'::jsonb)
  )
  from public.events e
  where e.share_id = p_share_id;
$$;

revoke all on function public.get_shared_event(text) from public;
grant execute on function public.get_shared_event(text) to anon, authenticated;
