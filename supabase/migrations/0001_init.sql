-- Worship Sets: initial schema
-- Leaders (editors) are identified by email. Everyone else only sees sets via share links.

create table public.leaders (
  email text primary key check (email = lower(email)),
  added_at timestamptz not null default now()
);

create or replace function public.is_leader()
returns boolean
language sql stable security definer set search_path = ''
as $$
  select exists (
    select 1 from public.leaders
    where email = lower(coalesce(auth.jwt() ->> 'email', ''))
  );
$$;

create table public.songs (
  id uuid primary key default gen_random_uuid(),
  title text not null,
  artist text,
  song_key text,
  tempo integer,
  time_sig text,
  tags text[] not null default '{}',
  notes text,
  pdf_path text,
  pdf_name text,
  created_by uuid default auth.uid(),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index songs_title_idx on public.songs (lower(title));

create table public.events (
  id uuid primary key default gen_random_uuid(),
  share_id text not null unique default translate(encode(extensions.gen_random_bytes(9), 'base64'), '+/', '-_'),
  name text not null,
  event_date date,
  start_time text,
  location text,
  heart text,
  scripture text,
  prayer_points text,
  notes text,
  created_by uuid default auth.uid(),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index events_date_idx on public.events (event_date desc);

create table public.event_songs (
  id uuid primary key default gen_random_uuid(),
  event_id uuid not null references public.events (id) on delete cascade,
  song_id uuid not null references public.songs (id) on delete cascade,
  position integer not null default 0,
  song_key text,
  notes text
);
create index event_songs_event_idx on public.event_songs (event_id, position);
create index event_songs_song_idx on public.event_songs (song_id);

create table public.event_team (
  id uuid primary key default gen_random_uuid(),
  event_id uuid not null references public.events (id) on delete cascade,
  name text not null,
  role text,
  position integer not null default 0
);
create index event_team_event_idx on public.event_team (event_id, position);

-- Row level security: only leaders touch tables directly.
alter table public.leaders enable row level security;
alter table public.songs enable row level security;
alter table public.events enable row level security;
alter table public.event_songs enable row level security;
alter table public.event_team enable row level security;

create policy "leaders manage leaders" on public.leaders
  for all to authenticated using (public.is_leader()) with check (public.is_leader());
create policy "leaders manage songs" on public.songs
  for all to authenticated using (public.is_leader()) with check (public.is_leader());
create policy "leaders manage events" on public.events
  for all to authenticated using (public.is_leader()) with check (public.is_leader());
create policy "leaders manage event_songs" on public.event_songs
  for all to authenticated using (public.is_leader()) with check (public.is_leader());
create policy "leaders manage event_team" on public.event_team
  for all to authenticated using (public.is_leader()) with check (public.is_leader());

-- Public read of a single set by its share id (no login needed).
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
    ), '[]'::jsonb)
  )
  from public.events e
  where e.share_id = p_share_id;
$$;

revoke all on function public.get_shared_event(text) from public;
grant execute on function public.get_shared_event(text) to anon, authenticated;
revoke all on function public.is_leader() from public, anon;
grant execute on function public.is_leader() to authenticated;

-- Storage for chart PDFs. Public bucket: files are only reachable by their random path,
-- which is only handed out through a set's share link.
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('charts', 'charts', true, 52428800, array['application/pdf'])
on conflict (id) do nothing;

create policy "leaders read charts" on storage.objects
  for select to authenticated using (bucket_id = 'charts' and public.is_leader());
create policy "leaders upload charts" on storage.objects
  for insert to authenticated with check (bucket_id = 'charts' and public.is_leader());
create policy "leaders update charts" on storage.objects
  for update to authenticated using (bucket_id = 'charts' and public.is_leader());
create policy "leaders delete charts" on storage.objects
  for delete to authenticated using (bucket_id = 'charts' and public.is_leader());

-- First leader. Further leaders are added from the app's Leaders screen.
-- insert into public.leaders (email) values ('you@example.com');
