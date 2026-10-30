-- 1. Every song needs an artist. Enforced for new songs and whenever a song's title/artist is
--    edited; older songs without one keep working and are flagged in the app until filled in.
create or replace function public.require_song_artist()
returns trigger
language plpgsql set search_path = ''
as $$
begin
  if coalesce(btrim(new.artist), '') = '' then
    raise exception 'Every song needs an artist.' using errcode = '23514';
  end if;
  return new;
end;
$$;

create trigger songs_require_artist
  before insert or update of title, artist on public.songs
  for each row execute function public.require_song_artist();

-- 2. Searchable words of each chart (chord/number lines stripped), read from the PDF once by
--    the app: at upload, or in the background for older charts (lyrics_indexed_at is null).
alter table public.songs add column lyrics text, add column lyrics_indexed_at timestamptz;

-- Lyrics search: letters/digits of the query in order, allowing spaces, punctuation and line
-- breaks between them, so "way maker" also finds "Way ma - ker" split over chord syllables.
create or replace function public.search_lyrics(p_query text)
returns table (id uuid, snippet text)
language plpgsql stable set search_path = ''
as $$
declare
  letters text := regexp_replace(lower(coalesce(p_query, '')), '[^[:alnum:]]', '', 'g');
  pat text;
begin
  if char_length(letters) < 4 then return; end if;
  pat := regexp_replace(letters, '(.)', '\1[^[:alnum:]]*', 'g');
  return query
    select s.id, substring(s.lyrics from '(?i).{0,60}' || pat || '.{0,60}')
    from public.songs s
    where s.lyrics ~* pat
    order by s.title
    limit 40;
end;
$$;

revoke all on function public.search_lyrics(text) from public, anon;
grant execute on function public.search_lyrics(text) to authenticated;
